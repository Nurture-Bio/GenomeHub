/**
 * GenomeHub AWS CDK Stack
 *
 * Architecture:
 *   Browser → CloudFront → ECS Fargate (Node.js app)
 *   Browser → S3 (multipart upload, direct via presigned URLs)
 *   ECS     → RDS PostgreSQL (file metadata)
 *   S3      → CloudFront (presigned download URLs bypass CDN for large files)
 *
 * @module
 */

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk     from 'aws-cdk-lib';
import * as ec2     from 'aws-cdk-lib/aws-ec2';
import * as ecs     from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as s3      from 'aws-cdk-lib/aws-s3';
import * as rds     from 'aws-cdk-lib/aws-rds';
import * as ssm     from 'aws-cdk-lib/aws-ssm';
import * as iam     from 'aws-cdk-lib/aws-iam';
import * as logs    from 'aws-cdk-lib/aws-logs';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { Construct } from 'constructs';

// Absolute paths — never depend on CWD
const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = path.resolve(__dirname, '../..');
const SEQCHAIN   = path.resolve(REPO_ROOT, '../SeqChain');

export class GenomeHubStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ── VPC ────────────────────────────────────────────────
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs:               2,
      natGateways:          1,        // 1 NAT keeps costs low; use 2 for HA
      subnetConfiguration: [
        { name: 'public',   subnetType: ec2.SubnetType.PUBLIC,             cidrMask: 24 },
        { name: 'private',  subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        { name: 'isolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED,    cidrMask: 24 },
      ],
    });

    // ── S3 Bucket ──────────────────────────────────────────
    const bucket = new s3.Bucket(this, 'GenomicFiles', {
      bucketName: `genome-hub-files-${this.account}-${this.region}`,

      // Hard blocks all public access — files only via presigned URLs
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption:        s3.BucketEncryption.S3_MANAGED,

      // Lifecycle — move to Intelligent-Tiering after 30d, Glacier after 180d
      lifecycleRules: [
        {
          id: 'tiering',
          transitions: [
            {
              storageClass:    s3.StorageClass.INTELLIGENT_TIERING,
              transitionAfter: cdk.Duration.days(30),
            },
            {
              storageClass:    s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(180),
            },
          ],
        },
        {
          // Clean up aborted multipart uploads
          id:                         'abort-incomplete-multipart',
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
        },
      ],

      cors: [
        {
          allowedMethods:  [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.HEAD],
          allowedOrigins:  ['*'],       // Tighten to your domain in production
          allowedHeaders:  ['*'],
          exposedHeaders:  ['ETag', 'Content-Range', 'Content-Length', 'Accept-Ranges'],
          maxAge:          3000,
        },
      ],

      versioned:          false,
      removalPolicy:      cdk.RemovalPolicy.RETAIN,  // Never auto-delete genomic data
    });

    // ── RDS PostgreSQL ─────────────────────────────────────
    const dbSg = new ec2.SecurityGroup(this, 'DbSg', { vpc, description: 'RDS PostgreSQL' });

    const db = new rds.DatabaseInstance(this, 'Postgres', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16,
      }),
      instanceType:   ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.SMALL),
      vpc,
      vpcSubnets:     { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSg],

      databaseName:   'genome_hub',
      credentials:    rds.Credentials.fromGeneratedSecret('postgres'),

      storageEncrypted:  true,
      multiAz:           false,       // Set true for production HA
      backupRetention:   cdk.Duration.days(7),
      deletionProtection: true,
      removalPolicy:     cdk.RemovalPolicy.RETAIN,

      parameterGroup: new rds.ParameterGroup(this, 'PgParams', {
        engine: rds.DatabaseInstanceEngine.postgres({
          version: rds.PostgresEngineVersion.VER_16,
        }),
        parameters: {
          // Tune for genomic metadata workloads
          'work_mem':             '32768',     // 32 MB
          'maintenance_work_mem': '262144',    // 256 MB
          'max_connections':      '100',
          'log_min_duration_statement': '1000', // log queries > 1s
        },
      }),
    });

    // ── ECS Cluster ────────────────────────────────────────
    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      containerInsights: true,
    });

    // ── Task IAM role ──────────────────────────────────────
    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    // Grant the Node.js app full access to the genomic files bucket only
    bucket.grantReadWrite(taskRole);

    // ── Log group ──────────────────────────────────────────
    const logGroup = new logs.LogGroup(this, 'AppLogs', {
      logGroupName:  '/genome-hub/app',
      retention:     logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ── Task definition (two containers: GenomeHub + SeqChain) ─

    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      cpu:            1024,
      memoryLimitMiB: 2048,
      taskRole,
    });

    // GenomeHub container — Express API + React client
    const appContainer = taskDef.addContainer('genomehub', {
      image: ecs.ContainerImage.fromAsset(REPO_ROOT, {
        exclude: ['**/cdk.out'],
        buildArgs: {
          VITE_GOOGLE_CLIENT_ID: '631098657995-b6gm7u609caa7si5h8ep3tj1cf8m9in2.apps.googleusercontent.com',
        },
      }),
      portMappings: [{ containerPort: 3000 }],
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'app' }),
      environment: {
        NODE_ENV:         'production',
        PORT:             '3000',
        AWS_REGION:       this.region,
        S3_BUCKET:        bucket.bucketName,
        GOOGLE_CLIENT_ID: '631098657995-b6gm7u609caa7si5h8ep3tj1cf8m9in2.apps.googleusercontent.com',
        SEQCHAIN_URL:     'http://localhost:8001',
      },
      secrets: {
        DATABASE_URL: ecs.Secret.fromSecretsManager(db.secret!),
      },
      essential: true,
    });

    // SeqChain container — Python analysis engine (sidecar)
    // Shares the task's network namespace, so GenomeHub reaches it
    // at localhost:8001. Shares the task IAM role, so it gets S3
    // access automatically. No ALB routing — internal only.
    const seqchainLogGroup = new logs.LogGroup(this, 'SeqChainLogs', {
      logGroupName:  '/genome-hub/seqchain',
      retention:     logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    taskDef.addContainer('seqchain', {
      // To use a pre-built image from ECR instead:
      //   image: ecs.ContainerImage.fromEcrRepository(repo, 'latest'),
      image: ecs.ContainerImage.fromAsset(SEQCHAIN, {
        file: 'Dockerfile.api',
      }),
      portMappings: [{ containerPort: 8001 }],
      logging: ecs.LogDrivers.awsLogs({ logGroup: seqchainLogGroup, streamPrefix: 'seqchain' }),
      environment: {
        AWS_REGION: this.region,
        S3_BUCKET:  bucket.bucketName,
      },
      essential: false,  // GenomeHub runs fine without analysis engine
    });

    // ── Fargate service ────────────────────────────────────
    const service = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'Service', {
      cluster,
      taskDefinition: taskDef,
      publicLoadBalancer: true,
      desiredCount:       1,
    });

    // Allow ECS to reach RDS
    dbSg.addIngressRule(
      service.service.connections.securityGroups[0],
      ec2.Port.tcp(5432),
      'ECS to PostgreSQL',
    );

    // Auto-scaling
    const scaling = service.service.autoScaleTaskCount({ maxCapacity: 4 });
    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown:  cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(30),
    });

    // ── CloudFront distribution ────────────────────────────

    // Custom cache policy: minimal TTL with cookies so CloudFront preserves
    // Set-Cookie headers for session auth.  Origin sends Cache-Control: no-store
    // to prevent actual caching.
    const noCacheWithCookies = new cloudfront.CachePolicy(this, 'NoCacheWithCookies', {
      cachePolicyName: `GenomeHub-NoCacheWithCookies-${this.account}`,
      minTtl:     cdk.Duration.seconds(0),
      maxTtl:     cdk.Duration.seconds(1),
      defaultTtl: cdk.Duration.seconds(0),
      cookieBehavior:      cloudfront.CacheCookieBehavior.all(),
      headerBehavior:      cloudfront.CacheHeaderBehavior.none(),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
    });

    // Cross-origin isolation headers (enables SharedArrayBuffer globally)
    // same-origin COOP + require-corp COEP = crossOriginIsolated in all browsers
    // (credentialless is Chromium-only; Safari requires require-corp)
    const coopCoepHeaders = new cloudfront.ResponseHeadersPolicy(this, 'CoopCoep', {
      responseHeadersPolicyName: `GenomeHub-CoopCoep-${this.account}`,
      customHeadersBehavior: {
        customHeaders: [
          { header: 'Cross-Origin-Opener-Policy',   value: 'same-origin',   override: true },
          { header: 'Cross-Origin-Embedder-Policy',  value: 'require-corp', override: true },
        ],
      },
    });

    const albOrigin = new origins.LoadBalancerV2Origin(service.loadBalancer, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
    });

    const distribution = new cloudfront.Distribution(this, 'Cdn', {
      defaultBehavior: {
        origin:                 albOrigin,
        viewerProtocolPolicy:   cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy:            noCacheWithCookies,
        allowedMethods:         cloudfront.AllowedMethods.ALLOW_ALL,
        cachedMethods:          cloudfront.CachedMethods.CACHE_GET_HEAD,
        originRequestPolicy:    cloudfront.OriginRequestPolicy.ALL_VIEWER,
        responseHeadersPolicy:  coopCoepHeaders,
      },
      // NOTE: Large genomic file downloads use S3 presigned URLs directly —
      // they bypass CloudFront entirely to avoid transfer cost doubling.
    });

    // ── Outputs ────────────────────────────────────────────

    new cdk.CfnOutput(this, 'AppUrl', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'GenomeHub application URL',
    });

    new cdk.CfnOutput(this, 'BucketName', {
      value: bucket.bucketName,
      description: 'S3 bucket for genomic files',
    });

    new cdk.CfnOutput(this, 'DbSecretArn', {
      value: db.secret!.secretArn,
      description: 'RDS credentials secret ARN',
    });

    new cdk.CfnOutput(this, 'LoadBalancerDns', {
      value: service.loadBalancer.loadBalancerDnsName,
      description: 'ALB DNS (for health checks / direct access)',
    });
  }
}

// ── App ──────────────────────────────────────────────────

const app = new cdk.App();
new GenomeHubStack(app, 'GenomeHub', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region:  process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
});

# GenomeHub

Genomic data management platform built on AWS. Upload, organize, and retrieve large genomic files (FASTQ, BAM, VCF, etc.) through a web interface backed by S3 multipart uploads and a PostgreSQL metadata catalog.

## Architecture

```
Browser --> CloudFront --> ALB --> ECS Fargate (Node.js)
                                       |
Browser -----> S3 (presigned URLs) <---+---> RDS PostgreSQL
```

- **Client** — React 19 + Vite + Tailwind CSS 4
- **Server** — Express + TypeORM, serves the built client and a REST API
- **Infra** — AWS CDK (TypeScript), single-stack deploy
- **Storage** — S3 with lifecycle rules (Intelligent-Tiering at 30d, Glacier at 180d)
- **Database** — PostgreSQL 16 on RDS (isolated subnet, encrypted)
- **CDN** — CloudFront in front of the ALB; large file downloads use S3 presigned URLs directly

Files never pass through the server — the browser uploads directly to S3 via presigned multipart URLs. The server coordinates metadata only.

## Project structure

```
packages/
  client/       React SPA (Vite)
  server/       Express API + TypeORM entities
  infra/        AWS CDK stack
```

## Prerequisites

- Node.js 22+
- Docker (for local PostgreSQL)
- AWS CLI configured with credentials
- AWS CDK CLI (`npm install -g aws-cdk`)

## Local development

```bash
# Start PostgreSQL
docker compose up -d

# Install dependencies
npm install

# Copy environment config
cp .env.example .env
# Edit .env with your AWS credentials and S3 bucket name

# Run client + server in parallel
npm run dev
```

The client runs on `http://localhost:5173` and proxies API requests to the server on port 3000.

## Deploy to AWS

```bash
npx cdk deploy --region us-west-2
```

This builds the Docker image, pushes it to ECR, and provisions:

| Resource | Details |
|---|---|
| VPC | 2 AZs, public/private/isolated subnets, 1 NAT gateway |
| S3 bucket | `genome-hub-files-{account}-{region}`, block all public access |
| RDS PostgreSQL 16 | `db.t4g.small`, isolated subnet, encrypted, 7-day backups |
| ECS Fargate | 0.5 vCPU / 1 GB, auto-scales to 4 tasks at 70% CPU |
| CloudFront | HTTPS redirect, API pass-through (no caching) |
| ALB | Public load balancer in front of Fargate |

Stack outputs include the CloudFront URL, S3 bucket name, RDS secret ARN, and ALB DNS.

## API

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/projects` | List projects with file counts |
| `POST` | `/api/projects` | Create a project |
| `GET` | `/api/files` | List files (optional `?projectId=`) |
| `DELETE` | `/api/files/:id` | Delete a file (S3 + DB) |
| `GET` | `/api/files/:id/download` | Get presigned download URL |
| `GET` | `/api/stats` | Storage stats by format |
| `POST` | `/api/uploads/initiate` | Start multipart upload |
| `POST` | `/api/uploads/part-url` | Get presigned URL for one part |
| `POST` | `/api/uploads/complete` | Finalize upload, mark file ready |
| `POST` | `/api/uploads/abort` | Abort a failed upload |

## Supported formats

FASTQ, BAM, CRAM, VCF, BCF, BED, GFF/GFF3, GTF, FASTA, SAM, BigWig, BigBed — auto-detected from file extension.

## Useful CDK commands

```bash
npx cdk diff          # Preview changes
npx cdk synth         # Emit CloudFormation template
npx cdk destroy       # Tear down stack (S3 + RDS are retained)
```

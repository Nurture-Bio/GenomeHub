import { useParams } from 'react-router-dom';
import { Heading, Text, Card } from '../ui';

export default function SampleDetailPage() {
  const { projectId, experimentId, sampleId } = useParams<{
    projectId: string;
    experimentId: string;
    sampleId: string;
  }>();

  return (
    <div className="flex flex-col gap-3 p-3">
      <Heading level="heading">Sample</Heading>
      <Card className="p-3">
        <Text variant="caption" as="p">Project: {projectId}</Text>
        <Text variant="caption" as="p">Experiment: {experimentId}</Text>
        <Text variant="caption" as="p">Sample: {sampleId}</Text>
        <Text variant="secondary" as="p" className="mt-1">Coming soon</Text>
      </Card>
    </div>
  );
}

import { useParams } from 'react-router-dom';
import { Heading, Text, Card } from '../ui';

export default function ExperimentDetailPage() {
  const { projectId, experimentId } = useParams<{
    projectId: string;
    experimentId: string;
  }>();

  return (
    <div className="flex flex-col gap-3 p-3">
      <Heading level="heading">Experiment</Heading>
      <Card className="p-3">
        <Text variant="caption" as="p">Project: {projectId}</Text>
        <Text variant="caption" as="p">Experiment: {experimentId}</Text>
        <Text variant="secondary" as="p" className="mt-1">Coming soon</Text>
      </Card>
    </div>
  );
}

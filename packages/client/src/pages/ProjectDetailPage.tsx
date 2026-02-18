import { useParams } from 'react-router-dom';
import { Heading, Text, Card } from '../ui';

export default function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();

  return (
    <div className="flex flex-col gap-3 p-3">
      <Heading level="heading">Project</Heading>
      <Card className="p-3">
        <Text variant="caption" as="p">Project ID: {projectId}</Text>
        <Text variant="secondary" as="p" className="mt-1">Coming soon</Text>
      </Card>
    </div>
  );
}

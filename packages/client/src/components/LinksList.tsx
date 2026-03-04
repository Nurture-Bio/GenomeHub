import { useState } from 'react';
import {
  useLinksQuery,
  useCreateLinkMutation,
  useDeleteLinkMutation,
  type LinkParentType,
} from '../hooks/useGenomicQueries';
import { Input, Text } from '../ui';
import LinkChip from './LinkChip';

interface LinksListProps {
  parentType: LinkParentType;
  parentId: string;
}

export default function LinksList({ parentType, parentId }: LinksListProps) {
  const { data: links } = useLinksQuery(parentType, parentId);
  const { createLink } = useCreateLinkMutation();
  const { deleteLink } = useDeleteLinkMutation(parentType, parentId);
  const [newUrl, setNewUrl] = useState('');

  const handleAdd = async () => {
    const url = newUrl.trim();
    if (!url) return;
    try {
      await createLink({ parentType, parentId, url });
      setNewUrl('');
    } catch {
      /* toast handles error */
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Text variant="muted">Links</Text>
      <div className="flex items-center gap-1.5 flex-wrap">
        {links?.map((link) => (
          <LinkChip
            key={link.id}
            url={link.url}
            label={link.label}
            service={link.service}
            onDelete={() => deleteLink(link.id)}
          />
        ))}
        <Input
          variant="transparent"
          size="sm"
          placeholder="Paste URL + Enter"
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd();
          }}
          className="w-44 border-dashed"
        />
      </div>
    </div>
  );
}

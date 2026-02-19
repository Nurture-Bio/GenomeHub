import { Technique } from '../entities/index.js';
import { referenceCrudRouter } from '../lib/reference_crud.js';

export default referenceCrudRouter({
  entity: Technique,
  entityType: 'technique',
  extraFields: [{ name: 'defaultTags', default: [] }],
});

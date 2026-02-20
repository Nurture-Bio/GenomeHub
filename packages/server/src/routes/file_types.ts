import { FileType } from '../entities/index.js';
import { referenceCrudRouter } from '../lib/reference_crud.js';

export default referenceCrudRouter({ entity: FileType, normalizeName: true });

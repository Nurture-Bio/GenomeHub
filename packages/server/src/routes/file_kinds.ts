import { FileKind } from '../entities/index.js';
import { referenceCrudRouter } from '../lib/reference_crud.js';

export default referenceCrudRouter({ entity: FileKind, normalizeName: true });

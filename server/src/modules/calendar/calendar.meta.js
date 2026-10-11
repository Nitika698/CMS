import { STATUSES, STATUS_LABELS } from '../content/content.constants.js';

export const CONTENT_STATUS_LIST = STATUSES.map((key) => ({ key, label: STATUS_LABELS[key] }));

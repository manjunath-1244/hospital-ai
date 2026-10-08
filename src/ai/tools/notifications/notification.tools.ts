import { ClinicalTool } from '../tool-registry';
import { buildProposeTools } from '../actions/propose.tools';

export function buildNotificationTools(): ClinicalTool[] {
  // Notification domain tool set includes proposeNotification
  const proposeTools = buildProposeTools();
  return proposeTools.filter((t) => t.name === 'proposeNotification');
}

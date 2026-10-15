import { checkCatalogRules } from '../model/validate';
import type { Exercise, Session } from '../model/types';

export type BlockFlag = 'unknown exercise' | 'metric mismatch';

const POINTER = /^\/session\/blocks\/(\d+)\/(exerciseId|sets\/)/;

/**
 * Spec 4 §7 and §12: the soft catalog issues of `session` (`checkCatalogRules`, spec 1 §5) per
 * block id, each kind once, so the session page and the Log cards flag the block the Sync tab's
 * soft card names. The pointer's index is the block's position in the file's `blocks` array.
 * Blocks without an issue are absent.
 */
export function blockFlags(session: Session, catalog: readonly Exercise[]): Map<string, string[]> {
  const flags = new Map<string, BlockFlag[]>();
  for (const issue of checkCatalogRules(session, catalog)) {
    const m = POINTER.exec(issue.path);
    if (m?.[1] === undefined) continue;
    const blockId = session.blocks[Number(m[1])]?.id;
    if (blockId === undefined) continue;
    const flag: BlockFlag = m[2] === 'exerciseId' ? 'unknown exercise' : 'metric mismatch';
    const list = flags.get(blockId) ?? [];
    if (!list.includes(flag)) list.push(flag);
    flags.set(blockId, list);
  }
  return flags;
}

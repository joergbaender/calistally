import type { JSX } from 'preact';
import { amountOf } from '../../../model/derive';
import type { WorkoutSet } from '../../../model/types';
import { formatAmount } from '../../format';

/** Spec 4 §4/§5: a block's sets as chips in the order given (callers pass liveSets); amounts in the device locale (§8); an aggregate set shows '100*'. */
export function SetChips(p: {
  sets: readonly WorkoutSet[];
  variant: 'today' | 'reference';
  lastIndex?: number;
  markIndex?: number;
  proposed?: number | undefined;
  onTap?(set: WorkoutSet): void;
}): JSX.Element {
  const classOf = (i: number): string => {
    const cls = ['setchips__chip'];
    if (i === p.lastIndex) cls.push('is-last');
    if (i === p.markIndex) cls.push('is-marked');
    return cls.join(' ');
  };
  const label = (s: WorkoutSet): string => `${formatAmount(amountOf(s))}${s.aggregate ? '*' : ''}`;
  const onTap = p.onTap;
  return (
    <div class={`setchips setchips--${p.variant}`}>
      {p.sets.map((s, i) =>
        onTap ? (
          <button key={s.id} type="button" class={classOf(i)} onClick={() => onTap(s)}>{label(s)}</button>
        ) : (
          <span key={s.id} class={classOf(i)}>{label(s)}</span>
        ),
      )}
      {typeof p.proposed === 'number' && (
        <span class="setchips__chip is-proposed" aria-label="proposed">{formatAmount(p.proposed)}</span>
      )}
    </div>
  );
}

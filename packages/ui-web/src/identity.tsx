import { avatarHue, initialsOf, RANK_HUES } from '@thelamp/shared';
import { cn } from './cn';

export interface AvatarProps {
  name: string;
  /** The person's ID, which picks their hue, the same in every app (`avatarHue`). */
  id: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Names the avatar for screen readers; leave out when the name is written beside it. */
  label?: boolean;
  className?: string;
}

/** A person without a photo: their initials on their own pastel hue (components/Avatar). */
export function Avatar({ name, id, size = 'md', label = false, className }: AvatarProps) {
  return (
    <span
      className={cn('ks-ico round', size !== 'md' && size, `hue-${avatarHue(id)}`, className)}
      {...(label ? { role: 'img', 'aria-label': name } : { 'aria-hidden': true })}
    >
      {initialsOf(name)}
    </span>
  );
}

/**
 * A place in a ranking on a round chip: gold, silver and bronze hues for the first three
 * (components/Avatar). The number is the text; `label` says what it is, such as "Rank 2".
 */
export function RankBadge({ rank, label }: { rank: number; label: string }) {
  const hue = RANK_HUES[rank as 1 | 2 | 3];
  return (
    <span className={cn('ks-seq', hue && `hue-${hue}`)} aria-label={label}>
      {rank}
    </span>
  );
}

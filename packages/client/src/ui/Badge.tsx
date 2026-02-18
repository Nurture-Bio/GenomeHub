import { type HTMLAttributes } from 'react';
import { cx } from 'class-variance-authority';
import { badge, type BadgeVariants } from './recipes';

type Props = HTMLAttributes<HTMLSpanElement> & BadgeVariants;

export default function Badge({ variant, color, className, ...props }: Props) {
  return <span className={cx(badge({ variant, color }), className)} {...props} />;
}

import { type HTMLAttributes } from 'react';
import { cx } from 'class-variance-authority';
import { card, type CardVariants } from './recipes';

type Props = HTMLAttributes<HTMLDivElement> & CardVariants;

export default function Card({ elevated, className, children, ...props }: Props) {
  return (
    <div className={cx(card({ elevated }), className)} {...props}>
      {children}
    </div>
  );
}

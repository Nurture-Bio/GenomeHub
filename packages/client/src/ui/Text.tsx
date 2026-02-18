import { type ElementType, type HTMLAttributes } from 'react';
import { cx } from 'class-variance-authority';
import { text, heading, type TextVariants, type HeadingVariants } from './recipes';

type TextProps = HTMLAttributes<HTMLElement> & TextVariants & {
  as?: ElementType;
};

export function Text({ as: Tag = 'span', variant, className, ...props }: TextProps) {
  return <Tag className={cx(text({ variant }), className)} {...props} />;
}

type HeadingProps = HTMLAttributes<HTMLElement> & HeadingVariants & {
  as?: ElementType;
};

export function Heading({ as: Tag = 'h2', level, className, ...props }: HeadingProps) {
  return <Tag className={cx(heading({ level }), className)} {...props} />;
}

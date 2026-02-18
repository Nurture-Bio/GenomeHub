import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cx } from 'class-variance-authority';
import { button, type ButtonVariants } from './recipes';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & ButtonVariants;

const Button = forwardRef<HTMLButtonElement, Props>(
  ({ intent, size, pending, className, ...props }, ref) => (
    <button ref={ref} className={cx(button({ intent, size, pending }), className)} {...props} />
  )
);
Button.displayName = 'Button';

export default Button;

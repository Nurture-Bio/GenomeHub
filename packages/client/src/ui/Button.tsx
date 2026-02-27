import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cx } from 'class-variance-authority';
import { button, type ButtonVariants } from './recipes';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & ButtonVariants;

const Button = forwardRef<HTMLButtonElement, Props>(
  ({ intent, size, pending, className, children, ...props }, ref) => (
    <button ref={ref} className={cx(button({ intent, size, pending }), className)} {...props}>
      {pending && (
        <span
          className="inline-block rounded-full overflow-hidden align-middle mr-1"
          style={{ width: 24, height: 6, background: 'currentColor', opacity: 0.25 }}
        >
          <span className="block h-full w-full progress-stripe" style={{ background: 'currentColor', opacity: 0.5 }} />
        </span>
      )}
      {children}
    </button>
  )
);
Button.displayName = 'Button';

export default Button;

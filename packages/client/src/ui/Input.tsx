import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cx } from 'class-variance-authority';
import { input, type InputVariants } from './recipes';

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & InputVariants;

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ variant, size, className, ...props }, ref) => (
    <input ref={ref} className={cx(input({ variant, size }), className)} {...props} />
  )
);
Input.displayName = 'Input';

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & InputVariants;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ variant, size, className, children, ...props }, ref) => (
    <select ref={ref} className={cx(input({ variant, size }), className)} {...props}>
      {children}
    </select>
  )
);
Select.displayName = 'Select';

type TextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'size'> & InputVariants;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ variant, size, className, ...props }, ref) => (
    <textarea ref={ref} className={cx(input({ variant, size }), className)} {...props} />
  )
);
Textarea.displayName = 'Textarea';

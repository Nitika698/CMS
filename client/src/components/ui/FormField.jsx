import { useId } from 'react';

const CONTROL =
  'block w-full rounded-lg border bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm disabled:bg-slate-100 disabled:text-slate-500';

function controlClass(error) {
  return `${CONTROL} ${error ? 'border-red-400' : 'border-slate-300'}`;
}

/** Label + control + hint/error wiring for accessibility. Pass a render function as children. */
export function FormField({ label, hint, error, required, children }) {
  const id = useId();
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-red-600">*</span>}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {error ? (
        <p id={`${id}-err`} className="mt-1.5 text-sm text-red-600">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="mt-1.5 text-sm text-slate-500">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

export function Input({ error, className = '', ...rest }) {
  return <input className={`${controlClass(error)} h-10 ${className}`} {...rest} />;
}

export function Textarea({ error, className = '', rows = 4, ...rest }) {
  return <textarea rows={rows} className={`${controlClass(error)} py-2 ${className}`} {...rest} />;
}

export function Select({ error, className = '', children, ...rest }) {
  return (
    <select className={`${controlClass(error)} h-10 ${className}`} {...rest}>
      {children}
    </select>
  );
}

"use client";

/**
 * Renders a form's fields for a respondent. Shared by /forms/[id] (public
 * submission) and the admin builder's live preview, so previews match the
 * public experience exactly. Values are held as: string (text/choice/date),
 * number, boolean (checkbox) and string[] (multiChoice).
 */
import { useId, useState } from "react";
import { AlertCircle, Asterisk, CalendarDays } from "lucide-react";
import { FORM_LIMITS } from "@/lib/forms";
import type { SubmissionErrors } from "@/lib/forms";
import type { Form, FormField } from "@/types/forms";

export type RendererValues = Record<string, string | number | boolean | string[]>;

interface FormRendererProps {
    form: Pick<Form, "fields">;
    values: RendererValues;
    errors: SubmissionErrors;
    onValueChange: (fieldId: string, value: string | number | boolean | string[]) => void;
    onBlur?: (fieldId: string) => void;
    /** In preview mode, submits are disabled and buttons are not rendered. */
    disabled?: boolean;
}

export default function FormRenderer({ form, values, errors, onValueChange, onBlur, disabled }: FormRendererProps) {
    return (
        <div className="space-y-6" role="group" aria-label="Form fields">
            {form.fields.map(field => (
                <FieldInput
                    key={field.id}
                    field={field}
                    value={values[field.id]}
                    error={errors[field.id]}
                    onChange={v => onValueChange(field.id, v)}
                    onBlur={onBlur ? () => onBlur(field.id) : undefined}
                    disabled={disabled}
                />
            ))}
        </div>
    );
}

function FieldInput({
    field, value, error, onChange, onBlur, disabled,
}: {
    field: FormField;
    value: string | number | boolean | string[] | undefined;
    error: string | undefined;
    onChange: (v: string | number | boolean | string[]) => void;
    onBlur?: () => void;
    disabled?: boolean;
}) {
    const id = useId();
    const errId = `${id}-err`;

    const shell = "w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-white placeholder:text-gray-500 focus:outline-none focus:border-blue-500/70 focus:ring-1 focus:ring-blue-500/40 disabled:opacity-50 transition-colors";
    const inputProps = {
        id,
        disabled,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": error ? errId : undefined,
        onBlur,
    } as const;

    return (
        <div>
            <label htmlFor={id} className="block text-sm font-semibold text-gray-200 mb-1.5">
                {field.label}
                {field.required && <span className="text-red-400 ml-1 inline-flex items-center" title="Required"><Asterisk size={14} aria-label="required" /></span>}
            </label>
            {field.helpText && <p id={`${id}-help`} className="text-xs text-gray-400 mb-2">{field.helpText}</p>}

            {field.type === "shortText" && (
                <input
                    {...inputProps}
                    type="text"
                    className={shell}
                    placeholder={field.placeholder || ""}
                    maxLength={FORM_LIMITS.answerShortText.max}
                    value={typeof value === "string" ? value : ""}
                    onChange={e => onChange(e.target.value)}
                />
            )}
            {field.type === "longText" && (
                <textarea
                    {...inputProps}
                    className={`${shell} min-h-32 resize-y`}
                    placeholder={field.placeholder || ""}
                    maxLength={FORM_LIMITS.answerLongText.max}
                    value={typeof value === "string" ? value : ""}
                    onChange={e => onChange(e.target.value)}
                />
            )}
            {field.type === "email" && (
                <input
                    {...inputProps}
                    type="email"
                    className={shell}
                    placeholder={field.placeholder || "you@example.com"}
                    maxLength={200}
                    value={typeof value === "string" ? value : ""}
                    onChange={e => onChange(e.target.value)}
                />
            )}
            {field.type === "phone" && (
                <input
                    {...inputProps}
                    type="tel"
                    className={shell}
                    placeholder={field.placeholder || "+91 98765 43210"}
                    maxLength={20}
                    value={typeof value === "string" ? value : ""}
                    onChange={e => onChange(e.target.value)}
                />
            )}
            {field.type === "number" && (
                <input
                    {...inputProps}
                    type="number"
                    className={shell}
                    placeholder={field.placeholder || ""}
                    min={field.min ?? undefined}
                    max={field.max ?? undefined}
                    value={typeof value === "number" || (typeof value === "string" && value !== "") ? String(value ?? "") : ""}
                    onChange={e => onChange(e.target.value === "" ? "" : Number(e.target.value))}
                />
            )}
            {field.type === "date" && (
                <div className="relative cursor-pointer" onClick={e => {
                    e.currentTarget.querySelector<HTMLInputElement>('input[type="date"]')?.showPicker();
                }}>
                    <input
                        {...inputProps}
                        type="date"
                        className={`${shell} pl-10`}
                        value={typeof value === "string" ? value : ""}
                        onChange={e => onChange(e.target.value)}
                    />
                    <button
                        type="button"
                        onClick={e => {
                            e.stopPropagation();
                            e.currentTarget.parentElement?.querySelector<HTMLInputElement>('input[type="date"]')?.showPicker();
                        }}
                        aria-label="Open date picker"
                        className="absolute left-3 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-white transition-colors"
                    >
                        <CalendarDays size={18} aria-hidden="true" />
                    </button>
                </div>
            )}
            {(field.type === "singleChoice" || field.type === "dropdown") && (
                <select
                    {...inputProps}
                    className={`${shell} appearance-none ${value ? "" : "text-gray-500"}`}
                    value={typeof value === "string" ? value : ""}
                    onChange={e => onChange(e.target.value)}
                >
                    <option value="" disabled className="bg-gray-900 text-gray-400">{field.placeholder || "Select an option…"}</option>
                    {field.options?.map(opt => (
                        <option key={opt} value={opt} className="bg-gray-900 text-white">{opt}</option>
                    ))}
                </select>
            )}
            {field.type === "multiChoice" && (
                <fieldset className="space-y-2" aria-invalid={error ? true : undefined}>
                    {field.options?.map(opt => {
                        const checked = Array.isArray(value) && value.includes(opt);
                        return (
                            <label key={opt} className="flex items-center gap-3 rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 cursor-pointer hover:bg-white/10 transition-colors">
                                <input
                                    type="checkbox"
                                    className="h-4 w-4 accent-blue-500"
                                    checked={checked}
                                    disabled={disabled}
                                    onChange={e => {
                                        const arr = Array.isArray(value) ? [...value] : [];
                                        if (e.target.checked) {
                                            if (!arr.includes(opt)) arr.push(opt);
                                        } else {
                                            const idx = arr.indexOf(opt);
                                            if (idx >= 0) arr.splice(idx, 1);
                                        }
                                        onChange(arr);
                                    }}
                                />
                                <span className="text-sm text-gray-200">{opt}</span>
                            </label>
                        );
                    })}
                </fieldset>
            )}
            {field.type === "checkbox" && (
                <label className="flex items-start gap-3 rounded-xl bg-white/5 border border-white/10 px-4 py-3 cursor-pointer hover:bg-white/10 transition-colors">
                    <input
                        type="checkbox"
                        id={id}
                        className="mt-0.5 h-4 w-4 accent-blue-500"
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? errId : undefined}
                        checked={value === true}
                        disabled={disabled}
                        onChange={e => onChange(e.target.checked)}
                        onBlur={onBlur}
                    />
                    <span className="text-sm text-gray-300">
                        {field.helpText && field.label === field.helpText ? field.label : field.label}
                    </span>
                </label>
            )}

            {error && (
                <p id={errId} role="alert" className="flex items-center gap-1.5 text-xs text-red-400 mt-1.5">
                    <AlertCircle size={13} className="shrink-0" aria-hidden="true" />
                    {error}
                </p>
            )}
        </div>
    );
}

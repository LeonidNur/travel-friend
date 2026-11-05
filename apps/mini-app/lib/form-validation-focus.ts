export function getFirstValidationErrorField<Field extends string>(
  errors: Readonly<Partial<Record<Field, string | undefined>>>,
  fieldOrder: readonly Field[]
): Field | null {
  return fieldOrder.find((field) => Boolean(errors[field])) ?? null;
}

export function focusFirstValidationErrorField<Field extends string>(
  errors: Readonly<Partial<Record<Field, string | undefined>>>,
  fieldOrder: readonly Field[],
  fields: Readonly<Partial<Record<Field, Readonly<{ focus: () => void }> | null>>>
): Field | null {
  const field = getFirstValidationErrorField(errors, fieldOrder);
  if (field !== null) {
    fields[field]?.focus();
  }

  return field;
}

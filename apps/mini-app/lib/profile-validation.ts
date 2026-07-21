export type ProfileValidationInput = Readonly<{
  name: string;
  city: string;
}>;

export type ProfileValidationErrors = {
  name?: 'Укажите имя';
  city?: 'Укажите город';
};

export type ProfileValidationResult = {
  errors: ProfileValidationErrors;
  isValid: boolean;
};

export function validateProfile({ name, city }: ProfileValidationInput): ProfileValidationResult {
  const errors: ProfileValidationErrors = {
    ...(name.trim().length === 0 ? { name: 'Укажите имя' } : {}),
    ...(city.trim().length === 0 ? { city: 'Укажите город' } : {})
  };

  return {
    errors,
    isValid: Object.keys(errors).length === 0
  };
}

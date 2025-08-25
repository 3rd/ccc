export const deepMerge = <T extends Record<string, unknown>>(target: T, source: Partial<T>): T => {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    const sourceValue = source[key];
    const targetValue = target[key];

    if (
      sourceValue &&
      typeof sourceValue === "object" &&
      !Array.isArray(sourceValue) &&
      targetValue &&
      typeof targetValue === "object" &&
      !Array.isArray(targetValue)
    ) {
      result[key as keyof T] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>,
      ) as T[typeof key];
    } else if (sourceValue !== undefined) {
      result[key as keyof T] = sourceValue as T[typeof key];
    }
  }

  return result;
};

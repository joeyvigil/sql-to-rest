// Identifier-casing helpers shared by the generator.

export function snake(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .replace(/__+/g, '_')
    .toLowerCase()
    .replace(/^_+|_+$/g, '')
}

export function pascal(name: string): string {
  return snake(name)
    .split('_')
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('')
}

/** Very small English singularizer — good enough for model class names. */
export function singularize(name: string): string {
  if (/ies$/i.test(name)) return name.replace(/ies$/i, 'y')
  if (/ses$/i.test(name)) return name.replace(/es$/i, '')
  if (/s$/i.test(name) && !/ss$/i.test(name)) return name.replace(/s$/i, '')
  return name
}

export function pluralize(name: string): string {
  if (/y$/i.test(name) && !/[aeiou]y$/i.test(name))
    return name.replace(/y$/i, 'ies')
  if (/(s|x|z|ch|sh)$/i.test(name)) return name + 'es'
  return name + 's'
}

/** PascalCase singular class name, e.g. "users" -> "User". */
export function className(tableName: string): string {
  return pascal(singularize(tableName))
}

/** snake_case singular variable name, e.g. "blog_posts" -> "blog_post". */
export function singularVar(tableName: string): string {
  return snake(singularize(tableName))
}

export const formatMediaTitle = (title: string): string =>
  title
    .trim()
    .split(/\s+/)
    .map((word) => {
      if (word.length > 1 && word === word.toLocaleUpperCase('tr-TR')) return word;
      return `${word.charAt(0).toLocaleUpperCase('tr-TR')}${word.slice(1)}`;
    })
    .join(' ');

import { describe, expect, it } from 'vitest';
import { paths } from './paths';

describe('paths', () => {
  it('builds the course landing path', () => {
    expect(paths.home()).toBe('/');
  });

  it('builds course paths and encodes opaque ids', () => {
    expect(paths.course('course one')).toBe('/courses/course%20one');
    expect(paths.course('course one', 'comments')).toBe('/courses/course%20one?tab=comments');
  });

  it('builds lesson reader paths', () => {
    expect(paths.lesson('course/a', 'lesson ?')).toBe('/courses/course%2Fa/lessons/lesson%20%3F');
    expect(paths.lesson('course/a', 'lesson ?', 'comment ?')).toBe('/courses/course%2Fa/lessons/lesson%20%3F?comment=comment%20%3F');
  });
});

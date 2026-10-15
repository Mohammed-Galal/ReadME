export type CourseTab = 'lessons' | 'comments';

const segment = (value: string) => encodeURIComponent(value);

export const paths = {
  home: () => '/',
  course: (courseId: string, tab: CourseTab = 'lessons') =>
    `/courses/${segment(courseId)}${tab === 'comments' ? '?tab=comments' : ''}`,
  lesson: (courseId: string, lessonId: string, commentId?: string) =>
    `/courses/${segment(courseId)}/lessons/${segment(lessonId)}${commentId ? `?comment=${segment(commentId)}` : ''}`,
};

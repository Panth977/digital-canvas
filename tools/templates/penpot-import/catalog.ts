/**
 * What we take from Penpot Hub. The files are CC BY 4.0 unless a `.LICENSE`
 * sits next to them (penpot-files CONTRIBUTING.md, "License"); we only list
 * files with no other licence. Authors are the ones Penpot Hub names.
 */
export interface BoardPick {
  /** Library id (a number is added when the pattern matches several boards). */
  id: string;
  title: string;
  /** Titles when the pattern matches several boards, left to right. */
  titles?: string[];
  category: string;
  tags: string;
  page?: RegExp;
  /**
   * The design has pictures the file's licence doesn't cover (stock photos,
   * brand logos): big ones become empty frames, small ones are left out.
   */
  stripImages?: boolean;
  board: RegExp;
}

export interface CatalogFile {
  file: string;
  slug: string;
  title: string;
  author: string;
  authorUrl?: string;
  licence: string;
  licenceUrl: string;
  boards: BoardPick[];
}

/** Boards left out after looking at the render next to the file's preview: id → why. */
export const DROPPED: Record<string, string> = {
  'flyer-master': 'a flattened picture of a real advert: no editable layers, unknown rights',
  'flyer-student': 'a faint tracing guide for a tutorial, not a design',
  'mobile-signup': 'mostly one blank frame once its unattributed photo is removed',
};

const CC_BY = { licence: 'CC-BY-4.0', licenceUrl: 'https://creativecommons.org/licenses/by/4.0/' };

export const CATALOG: CatalogFile[] = [
  { file: 'community-covers.penpot', slug: 'community-posters', title: 'Community posters', author: 'Systxema', ...CC_BY, boards: [
    { id: 'community-post', title: 'Community post', category: 'Social post', tags: 'social linkedin post announcement community', page: /^penpot$/, board: /^penpot_post/ } ] },
  { file: 'how-to-create-a-flyer.penpot', slug: 'how-to-create-a-flyer', title: 'How to create a flyer', author: 'Albert Kinng', ...CC_BY, boards: [
    { id: 'flyer-master', title: 'Event flyer', category: 'Flyer', tags: 'flyer event poster', page: /Tutorial/, board: /^Master Artwork/ },
    { id: 'flyer-student', title: 'Event flyer (blank)', category: 'Flyer', tags: 'flyer event poster', page: /Tutorial/, board: /^Student Artwork/ } ] },
  { file: 'curriculum.penpot', slug: 'curriculum', title: 'Curriculum', author: 'Enieber Cunha', ...CC_BY, boards: [
    { id: 'cv-enieber', title: 'One-column CV', titles: ['One-column CV, colour', 'One-column CV, print'], category: 'Resume', tags: 'resume cv job', board: /^home( print)?$/ },
    { id: 'cv-enieber-dark', title: 'One-column CV dark', titles: ['One-column CV, dark', 'One-column CV, dark print'], category: 'Resume', tags: 'resume cv job dark', board: /^home dark( print)?$/ } ] },
  { file: 'Just Another Resume Template.penpot', slug: 'just-another-resume-template', title: 'Just another resume template', author: 'Maximo Gomez', ...CC_BY, boards: [
    { id: 'resume-just-another', title: 'Just another resume', titles: ['Just another resume, light', 'Just another resume, dark'], category: 'Resume', tags: 'resume cv job', page: /^Resume$/, board: /^resume-light/ } ] },
  { file: 'Bingo.penpot', slug: 'bingo-reading-challenge', title: 'Bingo - Reading challenge', author: 'Marina Lopez', ...CC_BY, boards: [
    { id: 'bingo-reading', title: 'Reading challenge bingo', category: 'Game', tags: 'bingo reading book club game', page: /Reading challenge/, board: /^Reading challenge - Bingo/ } ] },
  { file: 'Persona template.penpot', slug: 'user-persona-template', title: 'User Persona Template', author: 'Mohamed Youssef', ...CC_BY, boards: [
    { id: 'persona', title: 'User persona', category: 'Planning', tags: 'persona ux research', page: /Persona template/, board: /^Persona$/, stripImages: true } ] },
  { file: 'Eisenhower Matrix.penpot', slug: 'eisenhower-matrix', title: 'Eisenhower matrix', author: 'Elhombretecla', ...CC_BY, boards: [
    { id: 'eisenhower', title: 'Eisenhower matrix', category: 'Planning', tags: 'priorities planning matrix', page: /^Matrix$/, board: /Matrix$/ } ] },
  { file: 'Community-Cards-grid-theme.penpot', slug: 'community-cards', title: 'Community cards', author: 'Systxema', ...CC_BY, boards: [
    { id: 'community-cards', title: 'Community cards', category: 'Presentation', tags: 'cards grid slide', page: /grid_theme/, board: /^cards$/ } ] },
  { file: 'Black-&-White-Mobile-Templates.penpot', slug: 'mobile-ui-starter-kit', title: 'Mobile UI Starter kit', author: 'ApeWTF', ...CC_BY, boards: [
    { id: 'mobile-news', title: 'News app', titles: ['News app', 'News app 2'], category: 'App screen', tags: 'mobile app ui news black white', page: /^Templates$/, board: /^News/, stripImages: true },
    { id: 'mobile-music', title: 'Music app', category: 'App screen', tags: 'mobile app ui music', page: /^Templates$/, board: /^Music$/, stripImages: true },
    { id: 'mobile-inbox', title: 'Inbox', category: 'App screen', tags: 'mobile app ui inbox mail', page: /^Templates$/, board: /^Inbox$/, stripImages: true },
    { id: 'mobile-signup', title: 'Sign up', category: 'App screen', tags: 'mobile app ui login form', page: /^Templates$/, board: /^Sign up$/, stripImages: true },
    { id: 'mobile-register', title: 'Register', category: 'App screen', tags: 'mobile app ui login form', page: /^Templates$/, board: /^register$/, stripImages: true },
    { id: 'mobile-settings', title: 'Settings', category: 'App screen', tags: 'mobile app ui settings', page: /^Templates$/, board: /^settings$/, stripImages: true },
    { id: 'mobile-email', title: 'Email', category: 'App screen', tags: 'mobile app ui mail', page: /^Templates$/, board: /^Email$/, stripImages: true },
    { id: 'mobile-video', title: 'Video player', category: 'App screen', tags: 'mobile app ui video', page: /^Templates$/, board: /^Video$/, stripImages: true },
    { id: 'mobile-blog', title: 'Blog', category: 'App screen', tags: 'mobile app ui blog', page: /^Templates$/, board: /^Blog$/, stripImages: true },
    { id: 'mobile-tags', title: 'Tags', category: 'App screen', tags: 'mobile app ui tags', page: /^Templates$/, board: /^tags$/, stripImages: true },
    { id: 'mobile-form', title: 'Form', category: 'App screen', tags: 'mobile app ui form', page: /^Templates$/, board: /^form$/ } ], stripImages: true },
  { file: 'ultimate-whiteboard-kit-templates.penpot', slug: 'ultimate-whiteboarding-kit', title: 'Ultimate whiteboarding kit', author: 'Renan Mayrinck', ...CC_BY, boards: [
    { id: 'wb-assumption-matrix', title: 'Assumption matrix', category: 'Planning', tags: 'whiteboard workshop matrix', board: /^Templates \/ Assumption Matrix/ },
    { id: 'wb-benchmark', title: 'Benchmark analysis', category: 'Planning', tags: 'whiteboard research benchmark', board: /^Templates \/ Benchmark/ },
    { id: 'wb-business-model', title: 'Business model canvas', category: 'Planning', tags: 'whiteboard business canvas', board: /^Templates \/ Business Model/ },
    { id: 'wb-consumer-behaviour', title: 'Consumer behaviour matrix', category: 'Planning', tags: 'whiteboard research matrix', board: /^Templates \/ Consumer/ },
    { id: 'wb-csd', title: 'CSD matrix', category: 'Planning', tags: 'whiteboard certainties suppositions doubts', board: /^Templates \/ CSD/ },
    { id: 'wb-discovery', title: 'Discovery test chart', category: 'Planning', tags: 'whiteboard discovery test', board: /^Templates \/ Discovery/ },
    { id: 'wb-gantt-12', title: 'Gantt chart, 12 months', category: 'Planning', tags: 'gantt schedule project', board: /^Templates \/ Gantt Chart - 12/ },
    { id: 'wb-gantt-6', title: 'Gantt chart, 6 months', category: 'Planning', tags: 'gantt schedule project', board: /^Templates \/ Gantt Chart - 6/ },
    { id: 'wb-persona-a', title: 'Persona chart A', category: 'Planning', tags: 'persona whiteboard', board: /^Templates \/ Persona Chart \[Type-A/, stripImages: true },
    { id: 'wb-persona-b', title: 'Persona chart B', category: 'Planning', tags: 'persona whiteboard', board: /^Templates \/ Persona Chart \[Type-B/, stripImages: true },
    { id: 'wb-swot', title: 'SWOT analysis', category: 'Planning', tags: 'swot strategy whiteboard', board: /^Templates \/ SWOT/ },
    { id: 'wb-journey-a', title: 'User journey map A', category: 'Planning', tags: 'journey map ux', board: /^Templates \/ User Journey Map \[Type-A/ },
    { id: 'wb-journey-b', title: 'User journey map B', category: 'Planning', tags: 'journey map ux', board: /^Templates \/ User Journey Map \[Type-B/ } ] },
];

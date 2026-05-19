/** One way to find the next catalog/search results page from HTML. */
export type PaginationStrategy = {
  id: string;
  findNext(html: string, currentUrl: string): string | null;
};

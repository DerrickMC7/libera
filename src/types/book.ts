// Mirrors the Book struct from Rust exactly
export interface Book {
  path: string;
  title: string;
  file_name: string;
  format: "pdf" | "epub";
  file_size: number;
}
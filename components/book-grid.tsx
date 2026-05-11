'use client';

import Link from 'next/link';
import { BOOKS, type Book } from '@/lib/books';

export function BookGrid() {
  return (
    <div className="il-grid">
      {BOOKS.map((book) => (
        <BookCard key={book.slug} book={book} />
      ))}
    </div>
  );
}

function BookCard({ book }: { book: Book }) {
  const meta = book.chapters ? `${book.chapters} 章` : '';

  return (
    <article className="il-card">
      {book.cover ? (
        <Link
          href={book.href}
          className="il-card-cover-btn"
          aria-label={`进入《${book.title}》前言`}
        >
          <span className="il-card-cover">
            <img
              src={book.cover}
              alt=""
              className="il-card-cover-img"
              loading="lazy"
              decoding="async"
            />
          </span>
        </Link>
      ) : (
        <Link
          href={book.href}
          className="il-card-cover-btn"
          aria-label={`进入《${book.title}》前言`}
        >
          <span className="il-card-cover">
            <span className="il-card-cover-placeholder">{book.tag}</span>
          </span>
        </Link>
      )}

      <div className="il-card-body">
        <Link href={book.href} className="il-card-link">
          <span className="il-card-tag">{book.tag}</span>
          <h3 className="il-card-title">{book.title}</h3>
          {book.subtitle && <p className="il-card-subtitle">{book.subtitle}</p>}
          <p className="il-card-desc">{book.desc}</p>
        </Link>
        <div className="il-card-meta">
          <span className="il-card-stats">{meta}</span>
          <Link href={book.href} className="il-card-arrow">
            read →
          </Link>
        </div>
      </div>
    </article>
  );
}

'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BOOKS, type Book } from '@/lib/books';

export function BookGrid() {
  const [lightbox, setLightbox] = useState<Book | null>(null);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [lightbox]);

  return (
    <>
      <div className="il-grid">
        {BOOKS.map((book) => (
          <BookCard
            key={book.slug}
            book={book}
            onCoverClick={book.cover ? () => setLightbox(book) : undefined}
          />
        ))}
      </div>

      {lightbox && lightbox.cover && (
        <div
          className="il-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`《${lightbox.title}》封面大图`}
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            className="il-lightbox-close"
            aria-label="关闭"
            onClick={(e) => {
              e.stopPropagation();
              setLightbox(null);
            }}
          >
            ×
          </button>
          <img
            src={lightbox.cover}
            alt={lightbox.title}
            className="il-lightbox-img"
            onClick={(e) => e.stopPropagation()}
          />
          <div className="il-lightbox-caption" onClick={(e) => e.stopPropagation()}>
            <div className="il-lightbox-title">{lightbox.title}</div>
            {lightbox.subtitle && (
              <div className="il-lightbox-subtitle">{lightbox.subtitle}</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function BookCard({
  book,
  onCoverClick,
}: {
  book: Book;
  onCoverClick?: () => void;
}) {
  const meta = book.chapters ? `${book.chapters} 章` : '';

  return (
    <article className="il-card">
      {book.cover ? (
        <button
          type="button"
          className="il-card-cover-btn"
          onClick={onCoverClick}
          aria-label={`查看《${book.title}》封面大图`}
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
        </button>
      ) : (
        <span className="il-card-cover" aria-hidden>
          <span className="il-card-cover-placeholder">{book.tag}</span>
        </span>
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

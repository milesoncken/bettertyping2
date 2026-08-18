import { memo } from "react";
import type { WordState } from "@bettertyping/engine";
import "./words.css";

/**
 * Renders the text. Character status is read from engine state — the view never
 * writes to the DOM to remember what happened, which is the single biggest
 * departure from v1.
 */

interface WordProps {
  word: WordState;
  active: boolean;
  /** Words behind the cursor keep their mistakes visible; words ahead are plain. */
  attempted: boolean;
}

const Word = memo(function Word({ word, active, attempted }: WordProps) {
  const length = Math.max(word.target.length, word.typed.length);
  const chars = [];

  for (let i = 0; i < length; i++) {
    const target = word.target.charAt(i);
    const typed = i < word.typed.length ? word.typed.charAt(i) : null;

    let status = "pending";
    if (typed !== null) {
      if (i >= word.target.length) status = "extra";
      else status = typed === target ? "correct" : "incorrect";
    } else if (attempted && !active) {
      status = "missed";
    }

    chars.push(
      <span key={i} className="char" data-status={status} data-i={i}>
        {i >= word.target.length ? typed : target}
      </span>,
    );
  }

  return (
    <span className="word" data-active={active || undefined}>
      {chars}
    </span>
  );
});

interface WordsProps {
  words: WordState[];
  cursorWord: number;
}

export const Words = memo(function Words({ words, cursorWord }: WordsProps) {
  return (
    <>
      {words.map((word, index) => (
        <Word
          key={index}
          word={word}
          active={index === cursorWord}
          attempted={index < cursorWord}
        />
      ))}
    </>
  );
});

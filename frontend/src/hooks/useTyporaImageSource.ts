import { useEffect, type RefObject } from 'react';
import type { Editor } from '@milkdown/kit/core';
import { editorViewCtx } from '@milkdown/core';
import { formatImageMarkdown, parseImageMarkdown } from '../utils/markdownImages';

const SHOW_SOURCE_CLASS = 'typora-show-source';
const SOURCE_CLASS = 'typora-image-source';

type ImageNodeAttrs = {
  src: string;
  caption: string;
};

function readImageBlockAttrs(editor: Editor, block: HTMLElement): ImageNodeAttrs | null {
  const view = editor.ctx.get(editorViewCtx);
  try {
    const pos = view.posAtDOM(block, 0);
    const node = view.state.doc.nodeAt(pos);
    if (node?.type.name !== 'image-block' || !node.attrs.src) {
      return null;
    }
    return {
      src: String(node.attrs.src),
      caption: String(node.attrs.caption ?? ''),
    };
  } catch {
    return null;
  }
}

function updateImageBlockAttrs(editor: Editor, block: HTMLElement, attrs: ImageNodeAttrs) {
  const view = editor.ctx.get(editorViewCtx);
  const pos = view.posAtDOM(block, 0);
  const node = view.state.doc.nodeAt(pos);
  if (node?.type.name !== 'image-block') return;

  if (node.attrs.src === attrs.src && node.attrs.caption === attrs.caption) {
    return;
  }

  view.dispatch(
    view.state.tr
      .setNodeAttribute(pos, 'src', attrs.src)
      .setNodeAttribute(pos, 'caption', attrs.caption),
  );
}

function hideAllSources(container: HTMLElement) {
  container.querySelectorAll(`.milkdown-image-block.${SHOW_SOURCE_CLASS}`).forEach((block) => {
    block.classList.remove(SHOW_SOURCE_CLASS);
  });
}

function ensureSourceElement(block: HTMLElement, attrs: ImageNodeAttrs): HTMLInputElement {
  let wrapper = block.querySelector<HTMLElement>(`.${SOURCE_CLASS}`);
  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.className = SOURCE_CLASS;

    const icon = document.createElement('span');
    icon.className = 'typora-image-source-icon';
    icon.setAttribute('aria-hidden', 'true');

    const input = document.createElement('input');
    input.className = 'typora-image-source-input';
    input.spellcheck = false;
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        input.blur();
      }
    });
    input.addEventListener('mousedown', (event) => event.stopPropagation());
    input.addEventListener('click', (event) => event.stopPropagation());

    wrapper.append(icon, input);
    block.appendChild(wrapper);
  }

  const input = wrapper.querySelector<HTMLInputElement>('.typora-image-source-input');
  if (!input) {
    throw new Error('Image source input missing');
  }
  input.value = formatImageMarkdown(attrs.src, attrs.caption);
  return input;
}

export function useTyporaImageSource(
  containerRef: RefObject<HTMLElement | null>,
  getEditor: () => Editor | undefined,
  loading: boolean,
) {
  useEffect(() => {
    if (loading) return undefined;

    const container = containerRef.current;
    if (!container) return undefined;

    const showSource = (block: HTMLElement) => {
      const editor = getEditor();
      if (!editor) return;

      const attrs = readImageBlockAttrs(editor, block);
      if (!attrs) return;

      hideAllSources(container);
      block.classList.add(SHOW_SOURCE_CLASS);
      const input = ensureSourceElement(block, attrs);
      window.requestAnimationFrame(() => {
        input.focus();
        input.select();
      });
    };

    const onSourceBlur = (block: HTMLElement, input: HTMLInputElement) => {
      const editor = getEditor();
      const currentAttrs = editor ? readImageBlockAttrs(editor, block) : null;
      const parsed = parseImageMarkdown(input.value);

      if (parsed && editor) {
        updateImageBlockAttrs(editor, block, parsed);
      } else if (currentAttrs) {
        input.value = formatImageMarkdown(currentAttrs.src, currentAttrs.caption);
      }

      block.classList.remove(SHOW_SOURCE_CLASS);
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const block = target.closest('.milkdown-image-block');
      if (!(block instanceof HTMLElement)) {
        hideAllSources(container);
        return;
      }

      if (target.closest(`.${SOURCE_CLASS}`)) {
        return;
      }

      if (target.closest('.image-wrapper') || target.tagName === 'IMG') {
        event.preventDefault();
        showSource(block);
      }
    };

    const onBlur = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || !target.classList.contains('typora-image-source-input')) {
        return;
      }

      const block = target.closest('.milkdown-image-block');
      if (!(block instanceof HTMLElement)) return;
      onSourceBlur(block, target);
    };

    const observer = new MutationObserver(() => {
      const editor = getEditor();
      if (!editor) return;

      container.querySelectorAll<HTMLElement>(`.milkdown-image-block.${SHOW_SOURCE_CLASS}`).forEach((block) => {
        const attrs = readImageBlockAttrs(editor, block);
        if (!attrs) return;

        const input = block.querySelector<HTMLInputElement>('.typora-image-source-input');
        if (!input || document.activeElement === input) return;
        input.value = formatImageMarkdown(attrs.src, attrs.caption);
      });
    });

    container.addEventListener('click', onClick, true);
    container.addEventListener('focusout', onBlur);
    observer.observe(container, { subtree: true, attributes: true, attributeFilter: ['class'] });

    return () => {
      container.removeEventListener('click', onClick, true);
      container.removeEventListener('focusout', onBlur);
      observer.disconnect();
      container.querySelectorAll(`.${SOURCE_CLASS}`).forEach((element) => element.remove());
      hideAllSources(container);
    };
  }, [containerRef, getEditor, loading]);
}

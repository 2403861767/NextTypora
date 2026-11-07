import { InputRule } from '@milkdown/kit/prose/inputrules';
import { TextSelection } from '@milkdown/kit/prose/state';
import { $inputRule } from '@milkdown/kit/utils';

/**
 * 让中文输入法也能唤起斜杠菜单（V104-05）。
 *
 * 中文输入法在中文标点模式下按 / 键打出的是「、」，全角模式下是「／」；Crepe 的斜杠菜单只认半角 "/"，
 * 而且这个判断写死在 BlockEdit 的 shouldShow 里，没有配置项。所以在菜单本来会弹出的位置——段落或标题里
 * 只有这一个字符、光标在它后面、不在列表项里（和 Crepe 的条件一致）——把它换成 "/"，菜单就照常弹出，
 * 接着输入的字照常用来筛选。
 *
 * 用输入规则实现：紧接着按 Backspace 会撤销这次替换，留下原来的「、」，想在段首写顿号的人照样写得出来。
 * 输入规则在输入法组字过程中不触发，组字结束（compositionend）时再检查一次，所以经过输入法的输入也能生效。
 */
export const slashMenuChineseTrigger = $inputRule(() => new InputRule(/^[、／]$/, (state, _match, start, end) => {
  const $start = state.doc.resolve(start);
  if (!['paragraph', 'heading'].includes($start.parent.type.name)) return null;
  if ($start.depth > 0 && $start.node($start.depth - 1).type.name === 'list_item') return null;
  // 这是块里唯一的文字：前面没有（正则的 ^ 只看光标前 500 个字符，所以再核对一次），后面也没有
  if ($start.parentOffset !== 0 || end !== $start.end()) return null;
  // insertText 只映射原来的选区；明确把光标放到 "/" 后面，菜单要求光标在块末尾
  const tr = state.tr.insertText('/', start, end);
  return tr.setSelection(TextSelection.create(tr.doc, start + 1));
}));

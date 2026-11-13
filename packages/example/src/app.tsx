import { useState } from 'react';
import UbbEditor from '@jswork/react-ubb/src';
import { UbbView, definePlugin } from '@jswork/react-ubb/src/renderer';
import '@jswork/react-ubb/src/style.scss';

const markPlugin = definePlugin({
  name: 'mark',
  label: '重点',
  valuePattern: /^(red|yellow)$/,
  render: ({ children, node }) => (
    <mark style={{ background: node.value === 'red' ? '#ffcccc' : '#ffffcc' }}>{children}</mark>
  ),
});

export default function App() {
  const [src, setSrc] = useState(
    '工单结论：[b]已解决[/b]，处理人 [color=#FF0000]张三[/color]。\n填空位：[blank]参考答案[/blank]，自定义插件：[mark=red]高亮[/mark]。',
  );
  const [dark, setDark] = useState(false);
  return (
    <div className={dark ? 'dark m-10 max-w-4xl space-y-6' : 'm-10 max-w-4xl space-y-6'}>
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold">react-ubb demo</h1>
        <button
          type="button"
          className="rounded border border-gray-300 px-3 py-1 text-sm dark:border-gray-600"
          onClick={() => setDark((v) => !v)}
        >
          {dark ? '☀️ 浅色' : '🌙 深色'}
        </button>
      </div>
      <div className={dark ? 'rounded-xl bg-[#141518] p-3' : ''}>
        <UbbEditor
          value={src}
          onChange={(s) => setSrc(s)}
          plugins={[markPlugin]}
          maxLength={200}
          theme={dark ? 'dark' : 'light'}
        />
      </div>
      <section className="space-y-2">
        <h2 className="font-semibold">H5 渲染（UbbView，与编辑器预览共用实现）</h2>
        <UbbView source={src} plugins={[markPlugin]} />
      </section>
      <section className="space-y-2">
        <h2 className="font-semibold">源文本（纯 string）</h2>
        <pre className="whitespace-pre-wrap rounded bg-gray-100 p-3 text-xs">{src}</pre>
      </section>
    </div>
  );
}

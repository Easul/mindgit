(() => {
  const zh = {
    'Working Tree': '工作区',
    'History': '历史记录',
    'Branch:': '分支：',
    'Modified:': '修改：',
    'Added:': '新增：',
    'Deleted:': '删除：',
    'Light': '浅色',
    'Dark': '深色',
    'Switch to light theme': '切换到浅色主题',
    'Switch to dark theme': '切换到深色主题',
    'Switch language': '切换语言',
    'Runtime': '运行状态',
    'Refresh': '刷新',
    'Search': '搜索',
    'Search with keyword': '输入关键词搜索',
    'Root actions': '项目操作',
    'File Review': '文件审查',
    'Search Results': '搜索结果',
    'Select a file to view its change summary and quick actions.': '选择文件后，这里会显示变更摘要和快捷操作。',
    'Enter a keyword to search the project.': '输入关键词后搜索整个项目。',
    'Select terminal text': '选择终端文本',
    'New terminal': '新建终端',
    'Show extra keys': '显示扩展按键',
    'Hide terminal': '隐藏终端',
    'Unlock MindGit': '解锁 MindGit',
    'Enter the access password configured for this MindGit instance.': '请输入此 MindGit 实例的访问密码。',
    'Unlock': '解锁',
    'MindGit Runtime': 'MindGit 运行状态',
    'Close runtime information': '关闭运行状态',
    'New Temporary Tab': '新建临时标签页',
    'Open File by Path...': '按路径打开文件…',
    'Open File by Path': '按路径打开文件',
    'Open': '打开',
    'Opened': '已打开',
    'Opening...': '正在打开…',
    'Path is required': '路径不能为空',
    'Enter any absolute path, or a path relative to the current project.': '请输入任意绝对路径，或相对于当前项目的路径。',
    'Opened read-only': '已以只读方式打开',
    'This file is read-only': '此文件为只读文件',
    'Read Only': '只读',
    'Save Temporary Tab?': '保存临时标签页？',
    "Don't Save": '不保存',
    'Open Terminal': '打开终端',
    'New Terminal': '新建终端',
    'New File': '新建文件',
    'New Folder': '新建文件夹',
    'Upload Files': '上传文件',
    'Copy Relative Path': '复制相对路径',
    'Copy Absolute Path': '复制绝对路径',
    'Download': '下载',
    'Rename': '重命名',
    'Delete': '删除',
    'Save As...': '另存为…',
    'Close Tab': '关闭标签页',
    'Diff': '差异',
    'Full': '完整内容',
    'Edit': '编辑',
    'Save': '保存',
    'Split Right': '向右拆分',
    'Split Down': '向下拆分',
    'Close Split': '关闭拆分',
    'Cancel': '取消',
    'Create': '创建',
    'Close': '关闭',
    'Replace': '替换',
    'All': '全部替换',
    'Prev': '上一个',
    'Next': '下一个',
    'Go': '跳转',
    'CPU': 'CPU',
    'Memory': '内存',
    'Process RSS': '进程实际内存',
    'Go Heap': 'Go 堆内存',
    'Go Reserved': 'Go 保留内存',
    'Heap Reserved': '堆保留内存',
    'Go Stack': 'Go 栈内存',
    'Go Metadata': 'Go 元数据',
    'Heap Objects': '堆对象',
    'Goroutines': '协程',
    'GC Runs': 'GC 次数',
    'Uptime': '运行时间',
    'Active Commands': '执行中命令',
    'Commands': '命令数',
    'Failed Commands': '失败命令',
    'Average Command': '平均命令耗时',
    'Terminals': '终端数',
    'Unavailable': '不可用',
    'Process RSS is the physical memory currently used by MindGit. Go reserved memory may be larger and is not fully resident. Managed process memory includes descendants where supported.': '进程实际内存是 MindGit 当前占用的物理内存。Go 保留内存可能更大，但并不代表这些内存都实际驻留。系统支持时，受管进程内存也会包含其子进程。',
    'Managed Processes': 'MindGit 管理的进程',
    'Child process memory': '子进程内存',
    'Type': '类型',
    'Process': '进程',
    'Running': '运行时间',
    'Actions': '操作',
    'MindGit': 'MindGit 主进程',
    'Git command': 'Git 命令',
    'SSH command': 'SSH 命令',
    'Shell command': 'Shell 命令',
    'Search command': '搜索命令',
    'Terminal': '终端',
    'SSH terminal': 'SSH 终端',
    'Command': '命令',
    'Close process': '关闭进程',
    'No managed processes': '没有运行中的受管进程',
    'This stops the selected command or terminal started by MindGit.': '这会停止由 MindGit 启动的所选命令或终端。',
    'No file selected': '未选择文件',
    'Select a file from the tree': '请从文件树选择文件',
    'Folder is empty': '文件夹为空',
    'Loading project...': '正在加载项目…',
    'Refreshing...': '正在刷新…',
    'Updated': '已更新',
    'Copied relative path': '已复制相对路径',
    'Copied absolute path': '已复制绝对路径',
    'Terminal selection copied': '已复制终端内容',
    'Renamed': '已重命名',
    'Folder created': '文件夹已创建',
    'File created': '文件已创建',
    'Deleting...': '正在删除…',
    'Renaming...': '正在重命名…',
    'Added': '新增',
    'Deleted': '删除',
    'Modified': '修改',
    'Untracked': '未跟踪',
    'Ignored': '已忽略',
    'Staged addition': '已暂存新增',
    'Staged deletion': '已暂存删除',
    'Staged modification': '已暂存修改',
    'Staged change': '已暂存变更',
    'with unstaged changes': '且有未暂存修改',
    'Select a commit to view its summary.': '选择提交后，这里会显示提交摘要。',
  };

  const originals = new WeakMap();
  const attributes = ['title', 'placeholder', 'aria-label'];
  let language = localStorage.getItem('mindgit-language');
  if (language !== 'zh' && language !== 'en') language = navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en';

  function translate(value) {
    if (language !== 'zh' || typeof value !== 'string') return value;
    if (zh[value]) return zh[value];
    let match = value.match(/^Changes \((\d+)\)$/);
    if (match) return `变更 (${match[1]})`;
    match = value.match(/^Upload to (.+)$/);
    if (match) return `上传到 ${match[1]}`;
    match = value.match(/^Rename (File|Folder)$/);
    if (match) return `重命名${match[1] === 'File' ? '文件' : '文件夹'}`;
    match = value.match(/^Delete (File|Folder)$/);
    if (match) return `删除${match[1] === 'File' ? '文件' : '文件夹'}`;
    match = value.match(/^Save the contents of "(.+)" before closing\?$/);
    if (match) return `关闭前是否保存“${match[1]}”的内容？`;
    match = value.match(/^(.+) \(read only\)$/);
    if (match) return `${match[1]}（只读）`;
    return value;
  }

  function skipped(node) {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return Boolean(element?.closest('#viewer, #file-list, #terminal-hosts, .file-tabs, script, style, code, pre'));
  }

  function localize(root = document.body) {
    if (!root || skipped(root)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    for (const node of textNodes) {
      if (skipped(node) || !node.nodeValue.trim()) continue;
      let original = originals.get(node);
      if (original === undefined) {
        original = node.nodeValue;
        originals.set(node, original);
      }
      const trimmed = original.trim();
      node.nodeValue = original.replace(trimmed, translate(trimmed));
    }
    const elements = root.nodeType === Node.ELEMENT_NODE ? [root, ...root.querySelectorAll('*')] : [];
    for (const element of elements) {
      if (skipped(element)) continue;
      let saved = originals.get(element);
      if (!saved) {
        saved = {};
        originals.set(element, saved);
      }
      for (const attribute of attributes) {
        if (!element.hasAttribute(attribute)) continue;
        if (!(attribute in saved)) saved[attribute] = element.getAttribute(attribute);
        element.setAttribute(attribute, translate(saved[attribute]));
      }
    }
    updateButton();
  }

  function updateButton() {
    const button = document.getElementById('language-toggle');
    if (!button) return;
    const text = language === 'zh' ? 'A' : '文';
    const title = language === 'zh' ? 'Switch to English' : '切换到中文';
    if (button.textContent !== text) button.textContent = text;
    if (button.title !== title) button.title = title;
    if (button.getAttribute('aria-label') !== title) button.setAttribute('aria-label', title);
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  }

  function setLanguage(next) {
    language = next === 'zh' ? 'zh' : 'en';
    localStorage.setItem('mindgit-language', language);
    localize(document.body);
    window.dispatchEvent(new CustomEvent('mindgit:languagechange', { detail: { language } }));
  }

  window.t = translate;
  window.mindGitLanguage = () => language;
  window.setMindGitLanguage = setLanguage;

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('language-toggle')?.addEventListener('click', () => setLanguage(language === 'zh' ? 'en' : 'zh'));
    localize(document.body);
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) localize(node);
          else if (node.nodeType === Node.TEXT_NODE && node.parentElement) localize(node.parentElement);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
})();

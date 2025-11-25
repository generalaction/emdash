module.exports = [
"[project]/docs/node_modules/fumadocs-ui/dist/utils/cn.js [app-rsc] (ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([]);
;
}),
"[project]/docs/node_modules/fumadocs-ui/dist/icons.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "Airplay",
    ()=>Airplay,
    "Check",
    ()=>Check,
    "ChevronDown",
    ()=>ChevronDown,
    "ChevronLeft",
    ()=>ChevronLeft,
    "ChevronRight",
    ()=>ChevronRight,
    "ChevronUp",
    ()=>ChevronUp,
    "ChevronsUpDown",
    ()=>ChevronsUpDown,
    "CircleCheck",
    ()=>CircleCheck,
    "CircleX",
    ()=>CircleX,
    "Clipboard",
    ()=>Clipboard,
    "Copy",
    ()=>Copy,
    "Edit",
    ()=>Edit,
    "ExternalLink",
    ()=>ExternalLink,
    "File",
    ()=>File,
    "FileText",
    ()=>FileText,
    "Folder",
    ()=>Folder,
    "FolderOpen",
    ()=>FolderOpen,
    "Hash",
    ()=>Hash,
    "Info",
    ()=>Info,
    "Languages",
    ()=>Languages,
    "Link",
    ()=>Link,
    "LoaderCircle",
    ()=>LoaderCircle,
    "Menu",
    ()=>Menu,
    "Moon",
    ()=>Moon,
    "Plus",
    ()=>Plus,
    "Search",
    ()=>Search,
    "Sidebar",
    ()=>Sidebar,
    "Star",
    ()=>Star,
    "Sun",
    ()=>Sun,
    "Text",
    ()=>Text,
    "Trash2",
    ()=>Trash2,
    "TriangleAlert",
    ()=>TriangleAlert,
    "X",
    ()=>X
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-jsx-runtime.js [app-rsc] (ecmascript)");
/**
 * @license lucide-react - ISC
 *
 * All copyright belongs to https://github.com/lucide-icons/lucide, we bundle it as part of library to avoid upstream issues.
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$utils$2f$cn$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-ui/dist/utils/cn.js [app-rsc] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$tailwind$2d$merge$2f$dist$2f$bundle$2d$mjs$2e$mjs__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__twMerge__as__cn$3e$__ = __turbopack_context__.i("[project]/docs/node_modules/tailwind-merge/dist/bundle-mjs.mjs [app-rsc] (ecmascript) <export twMerge as cn>");
;
;
;
const defaultAttributes = {
    xmlns: 'http://www.w3.org/2000/svg',
    width: 24,
    height: 24,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round'
};
const createLucideIcon = (iconName, iconNode)=>{
    const Component = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["forwardRef"])(({ className, size = 24, color = 'currentColor', children, ...props }, ref)=>{
        return (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxs"])("svg", {
            ref: ref,
            ...defaultAttributes,
            width: size,
            height: size,
            stroke: color,
            className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$tailwind$2d$merge$2f$dist$2f$bundle$2d$mjs$2e$mjs__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__twMerge__as__cn$3e$__["cn"])('lucide', className),
            ...props,
            children: [
                iconNode.map(([tag, attr])=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["createElement"])(tag, attr)),
                children
            ]
        });
    });
    Component.displayName = iconName;
    return Component;
};
const ChevronDown = createLucideIcon('chevron-down', [
    [
        'path',
        {
            d: 'm6 9 6 6 6-6',
            key: 'qrunsl'
        }
    ]
]);
const Languages = createLucideIcon('languages', [
    [
        'path',
        {
            d: 'm5 8 6 6',
            key: '1wu5hv'
        }
    ],
    [
        'path',
        {
            d: 'm4 14 6-6 2-3',
            key: '1k1g8d'
        }
    ],
    [
        'path',
        {
            d: 'M2 5h12',
            key: 'or177f'
        }
    ],
    [
        'path',
        {
            d: 'M7 2h1',
            key: '1t2jsx'
        }
    ],
    [
        'path',
        {
            d: 'm22 22-5-10-5 10',
            key: 'don7ne'
        }
    ],
    [
        'path',
        {
            d: 'M14 18h6',
            key: '1m8k6r'
        }
    ]
]);
const Sidebar = createLucideIcon('panel-left', [
    [
        'rect',
        {
            width: '18',
            height: '18',
            x: '3',
            y: '3',
            rx: '2',
            key: 'afitv7'
        }
    ],
    [
        'path',
        {
            d: 'M9 3v18',
            key: 'fh3hqa'
        }
    ]
]);
const ChevronsUpDown = createLucideIcon('chevrons-up-down', [
    [
        'path',
        {
            d: 'm7 15 5 5 5-5',
            key: '1hf1tw'
        }
    ],
    [
        'path',
        {
            d: 'm7 9 5-5 5 5',
            key: 'sgt6xg'
        }
    ]
]);
const Search = createLucideIcon('search', [
    [
        'circle',
        {
            cx: '11',
            cy: '11',
            r: '8',
            key: '4ej97u'
        }
    ],
    [
        'path',
        {
            d: 'm21 21-4.3-4.3',
            key: '1qie3q'
        }
    ]
]);
const ExternalLink = createLucideIcon('external-link', [
    [
        'path',
        {
            d: 'M15 3h6v6',
            key: '1q9fwt'
        }
    ],
    [
        'path',
        {
            d: 'M10 14 21 3',
            key: 'gplh6r'
        }
    ],
    [
        'path',
        {
            d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
            key: 'a6xqqp'
        }
    ]
]);
const Moon = createLucideIcon('moon', [
    [
        'path',
        {
            d: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z',
            key: 'a7tn18'
        }
    ]
]);
const Sun = createLucideIcon('sun', [
    [
        'circle',
        {
            cx: '12',
            cy: '12',
            r: '4',
            key: '4exip2'
        }
    ],
    [
        'path',
        {
            d: 'M12 2v2',
            key: 'tus03m'
        }
    ],
    [
        'path',
        {
            d: 'M12 20v2',
            key: '1lh1kg'
        }
    ],
    [
        'path',
        {
            d: 'm4.93 4.93 1.41 1.41',
            key: '149t6j'
        }
    ],
    [
        'path',
        {
            d: 'm17.66 17.66 1.41 1.41',
            key: 'ptbguv'
        }
    ],
    [
        'path',
        {
            d: 'M2 12h2',
            key: '1t8f8n'
        }
    ],
    [
        'path',
        {
            d: 'M20 12h2',
            key: '1q8mjw'
        }
    ],
    [
        'path',
        {
            d: 'm6.34 17.66-1.41 1.41',
            key: '1m8zz5'
        }
    ],
    [
        'path',
        {
            d: 'm19.07 4.93-1.41 1.41',
            key: '1shlcs'
        }
    ]
]);
const Airplay = createLucideIcon('airplay', [
    [
        'path',
        {
            d: 'M5 17H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-1',
            key: 'ns4c3b'
        }
    ],
    [
        'path',
        {
            d: 'm12 15 5 6H7Z',
            key: '14qnn2'
        }
    ]
]);
const Menu = createLucideIcon('menu', [
    [
        'line',
        {
            x1: '4',
            x2: '20',
            y1: '12',
            y2: '12',
            key: '1e0a9i'
        }
    ],
    [
        'line',
        {
            x1: '4',
            x2: '20',
            y1: '6',
            y2: '6',
            key: '1owob3'
        }
    ],
    [
        'line',
        {
            x1: '4',
            x2: '20',
            y1: '18',
            y2: '18',
            key: 'yk5zj1'
        }
    ]
]);
const X = createLucideIcon('x', [
    [
        'path',
        {
            d: 'M18 6 6 18',
            key: '1bl5f8'
        }
    ],
    [
        'path',
        {
            d: 'm6 6 12 12',
            key: 'd8bk6v'
        }
    ]
]);
const LoaderCircle = createLucideIcon('loader-circle', [
    [
        'path',
        {
            d: 'M21 12a9 9 0 1 1-6.219-8.56',
            key: '13zald'
        }
    ]
]);
const CircleCheck = createLucideIcon('circle-check', [
    [
        'circle',
        {
            cx: '12',
            cy: '12',
            r: '10',
            key: '1mglay'
        }
    ],
    [
        'path',
        {
            d: 'm9 12 2 2 4-4',
            key: 'dzmm74'
        }
    ]
]);
const CircleX = createLucideIcon('circle-x', [
    [
        'circle',
        {
            cx: '12',
            cy: '12',
            r: '10',
            key: '1mglay'
        }
    ],
    [
        'path',
        {
            d: 'm15 9-6 6',
            key: '1uzhvr'
        }
    ],
    [
        'path',
        {
            d: 'm9 9 6 6',
            key: 'z0biqf'
        }
    ]
]);
const Check = createLucideIcon('check', [
    [
        'path',
        {
            d: 'M20 6 9 17l-5-5',
            key: '1gmf2c'
        }
    ]
]);
const TriangleAlert = createLucideIcon('triangle-alert', [
    [
        'path',
        {
            d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3',
            key: 'wmoenq'
        }
    ],
    [
        'path',
        {
            d: 'M12 9v4',
            key: 'juzpu7'
        }
    ],
    [
        'path',
        {
            d: 'M12 17h.01',
            key: 'p32p05'
        }
    ]
]);
const Info = createLucideIcon('info', [
    [
        'circle',
        {
            cx: '12',
            cy: '12',
            r: '10',
            key: '1mglay'
        }
    ],
    [
        'path',
        {
            d: 'M12 16v-4',
            key: '1dtifu'
        }
    ],
    [
        'path',
        {
            d: 'M12 8h.01',
            key: 'e9boi3'
        }
    ]
]);
const Copy = createLucideIcon('copy', [
    [
        'rect',
        {
            width: '14',
            height: '14',
            x: '8',
            y: '8',
            rx: '2',
            ry: '2',
            key: '17jyea'
        }
    ],
    [
        'path',
        {
            d: 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2',
            key: 'zix9uf'
        }
    ]
]);
const Clipboard = createLucideIcon('clipboard', [
    [
        'rect',
        {
            width: '8',
            height: '4',
            x: '8',
            y: '2',
            rx: '1',
            ry: '1',
            key: '1'
        }
    ],
    [
        'path',
        {
            d: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2',
            key: '2'
        }
    ]
]);
const FileText = createLucideIcon('file-text', [
    [
        'path',
        {
            d: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z',
            key: '1rqfz7'
        }
    ],
    [
        'path',
        {
            d: 'M14 2v4a2 2 0 0 0 2 2h4',
            key: 'tnqrlb'
        }
    ],
    [
        'path',
        {
            d: 'M10 9H8',
            key: 'b1mrlr'
        }
    ],
    [
        'path',
        {
            d: 'M16 13H8',
            key: 't4e002'
        }
    ],
    [
        'path',
        {
            d: 'M16 17H8',
            key: 'z1uh3a'
        }
    ]
]);
const Hash = createLucideIcon('hash', [
    [
        'line',
        {
            x1: '4',
            x2: '20',
            y1: '9',
            y2: '9',
            key: '4lhtct'
        }
    ],
    [
        'line',
        {
            x1: '4',
            x2: '20',
            y1: '15',
            y2: '15',
            key: 'vyu0kd'
        }
    ],
    [
        'line',
        {
            x1: '10',
            x2: '8',
            y1: '3',
            y2: '21',
            key: '1ggp8o'
        }
    ],
    [
        'line',
        {
            x1: '16',
            x2: '14',
            y1: '3',
            y2: '21',
            key: 'weycgp'
        }
    ]
]);
const Text = createLucideIcon('text', [
    [
        'path',
        {
            d: 'M15 18H3',
            key: 'olowqp'
        }
    ],
    [
        'path',
        {
            d: 'M17 6H3',
            key: '16j9eg'
        }
    ],
    [
        'path',
        {
            d: 'M21 12H3',
            key: '2avoz0'
        }
    ]
]);
const File = createLucideIcon('file', [
    [
        'path',
        {
            d: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z',
            key: '1rqfz7'
        }
    ],
    [
        'path',
        {
            d: 'M14 2v4a2 2 0 0 0 2 2h4',
            key: 'tnqrlb'
        }
    ]
]);
const Folder = createLucideIcon('folder', [
    [
        'path',
        {
            d: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z',
            key: '1kt360'
        }
    ]
]);
const FolderOpen = createLucideIcon('folder-open', [
    [
        'path',
        {
            d: 'm6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2',
            key: 'usdka0'
        }
    ]
]);
const Star = createLucideIcon('star', [
    [
        'path',
        {
            d: 'M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z',
            key: 'r04s7s'
        }
    ]
]);
const Link = createLucideIcon('link', [
    [
        'path',
        {
            d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71',
            key: '1cjeqo'
        }
    ],
    [
        'path',
        {
            d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
            key: '19qd67'
        }
    ]
]);
const Edit = createLucideIcon('square-pen', [
    [
        'path',
        {
            d: 'M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7',
            key: '1m0v6g'
        }
    ],
    [
        'path',
        {
            d: 'M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z',
            key: 'ohrbg2'
        }
    ]
]);
const ChevronRight = createLucideIcon('chevron-right', [
    [
        'path',
        {
            d: 'm9 18 6-6-6-6',
            key: 'mthhwq'
        }
    ]
]);
const ChevronLeft = createLucideIcon('chevron-left', [
    [
        'path',
        {
            d: 'm15 18-6-6 6-6',
            key: '1wnfg3'
        }
    ]
]);
const Plus = createLucideIcon('plus', [
    [
        'path',
        {
            d: 'M5 12h14',
            key: '1ays0h'
        }
    ],
    [
        'path',
        {
            d: 'M12 5v14',
            key: 's699le'
        }
    ]
]);
const Trash2 = createLucideIcon('trash-2', [
    [
        'path',
        {
            d: 'M3 6h18',
            key: 'd0wm0j'
        }
    ],
    [
        'path',
        {
            d: 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6',
            key: '4alrt4'
        }
    ],
    [
        'path',
        {
            d: 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2',
            key: 'v07s0e'
        }
    ],
    [
        'line',
        {
            x1: '10',
            x2: '10',
            y1: '11',
            y2: '17',
            key: '1uufr5'
        }
    ],
    [
        'line',
        {
            x1: '14',
            x2: '14',
            y1: '11',
            y2: '17',
            key: 'xtxkd'
        }
    ]
]);
const ChevronUp = createLucideIcon('chevron-up', [
    [
        'path',
        {
            d: 'm18 15-6-6-6 6',
            key: '153udz'
        }
    ]
]);
}),
"[project]/docs/node_modules/fumadocs-ui/dist/components/ui/button.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "buttonVariants",
    ()=>buttonVariants
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$class$2d$variance$2d$authority$2f$dist$2f$index$2e$mjs__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/class-variance-authority/dist/index.mjs [app-rsc] (ecmascript)");
;
const variants = {
    primary: 'bg-fd-primary text-fd-primary-foreground hover:bg-fd-primary/80',
    outline: 'border hover:bg-fd-accent hover:text-fd-accent-foreground',
    ghost: 'hover:bg-fd-accent hover:text-fd-accent-foreground',
    secondary: 'border bg-fd-secondary text-fd-secondary-foreground hover:bg-fd-accent hover:text-fd-accent-foreground'
};
const buttonVariants = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$class$2d$variance$2d$authority$2f$dist$2f$index$2e$mjs__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cva"])('inline-flex items-center justify-center rounded-md p-2 text-sm font-medium transition-colors duration-100 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring', {
    variants: {
        variant: variants,
        // fumadocs use `color` instead of `variant`
        color: variants,
        size: {
            sm: 'gap-1 px-2 py-1.5 text-xs',
            icon: 'p-1.5 [&_svg]:size-5',
            'icon-sm': 'p-1.5 [&_svg]:size-4.5',
            'icon-xs': 'p-1 [&_svg]:size-4'
        }
    }
});
}),
"[project]/docs/node_modules/fumadocs-ui/dist/components/layout/sidebar.js [app-rsc] (client reference proxy) <module evaluation>", ((__turbopack_context__) => {
"use strict";

// This file is generated by next-core EcmascriptClientReferenceModule.
__turbopack_context__.s([
    "Sidebar",
    ()=>Sidebar,
    "SidebarCollapseTrigger",
    ()=>SidebarCollapseTrigger,
    "SidebarContent",
    ()=>SidebarContent,
    "SidebarContentMobile",
    ()=>SidebarContentMobile,
    "SidebarFolder",
    ()=>SidebarFolder,
    "SidebarFolderContent",
    ()=>SidebarFolderContent,
    "SidebarFolderLink",
    ()=>SidebarFolderLink,
    "SidebarFolderTrigger",
    ()=>SidebarFolderTrigger,
    "SidebarFooter",
    ()=>SidebarFooter,
    "SidebarHeader",
    ()=>SidebarHeader,
    "SidebarItem",
    ()=>SidebarItem,
    "SidebarPageTree",
    ()=>SidebarPageTree,
    "SidebarSeparator",
    ()=>SidebarSeparator,
    "SidebarTrigger",
    ()=>SidebarTrigger,
    "SidebarViewport",
    ()=>SidebarViewport
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-server-dom-turbopack-server.js [app-rsc] (ecmascript)");
;
const Sidebar = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call Sidebar() from the server but Sidebar is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/components/layout/sidebar.js <module evaluation>", "Sidebar");
const SidebarCollapseTrigger = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call SidebarCollapseTrigger() from the server but SidebarCollapseTrigger is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/components/layout/sidebar.js <module evaluation>", "SidebarCollapseTrigger");
const SidebarContent = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call SidebarContent() from the server but SidebarContent is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/components/layout/sidebar.js <module evaluation>", "SidebarContent");
const SidebarContentMobile = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call SidebarContentMobile() from the server but SidebarContentMobile is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/components/layout/sidebar.js <module evaluation>", "SidebarContentMobile");
const SidebarFolder = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call SidebarFolder() from the server but SidebarFolder is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/components/layout/sidebar.js <module evaluation>", "SidebarFolder");
const SidebarFolderContent = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call SidebarFolderContent() from the server but SidebarFolderContent is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/components/layout/sidebar.js <module evaluation>", "SidebarFolderContent");
const SidebarFolderLink = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call SidebarFolderLink() from the server but SidebarFolderLink is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/components/layout/sidebar.js <module evaluation>", "SidebarFolderLink");
const SidebarFolderTrigger = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call SidebarFolderTrigger() from the server but SidebarFolderTrigger is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/components/layout/sidebar.js <module evaluation>", "SidebarFolderTrigger");
const SidebarFooter = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call SidebarFooter() from the server but SidebarFooter is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/components/layout/sidebar.js <module evaluation>", "SidebarFooter");
const SidebarHeader = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call SidebarHeader() from the server but SidebarHeader is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/components/layout/sidebar.js <module evaluation>", "SidebarHeader");
const SidebarItem = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call SidebarItem() from the server but SidebarItem is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/components/layout/sidebar.js <module evaluation>", "SidebarItem");
const SidebarPageTree = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call SidebarPageTree() from the server but SidebarPageTree is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/components/layout/sidebar.js <module evaluation>", "SidebarPageTree");
const SidebarSeparator = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call SidebarSeparator() from the server but SidebarSeparator is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/components/layout/sidebar.js <module evaluation>", "SidebarSeparator");
const SidebarTrigger = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call SidebarTrigger() from the server but SidebarTrigger is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/components/layout/sidebar.js <module evaluation>", "SidebarTrigger");
const SidebarViewport = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call SidebarViewport() from the server but SidebarViewport is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/components/layout/sidebar.js <module evaluation>", "SidebarViewport");
}),
"[project]/docs/node_modules/fumadocs-ui/dist/components/layout/sidebar.js [app-rsc] (client reference proxy)", ((__turbopack_context__) => {
"use strict";

// This file is generated by next-core EcmascriptClientReferenceModule.
__turbopack_context__.s([
    "Sidebar",
    ()=>Sidebar,
    "SidebarCollapseTrigger",
    ()=>SidebarCollapseTrigger,
    "SidebarContent",
    ()=>SidebarContent,
    "SidebarContentMobile",
    ()=>SidebarContentMobile,
    "SidebarFolder",
    ()=>SidebarFolder,
    "SidebarFolderContent",
    ()=>SidebarFolderContent,
    "SidebarFolderLink",
    ()=>SidebarFolderLink,
    "SidebarFolderTrigger",
    ()=>SidebarFolderTrigger,
    "SidebarFooter",
    ()=>SidebarFooter,
    "SidebarHeader",
    ()=>SidebarHeader,
    "SidebarItem",
    ()=>SidebarItem,
    "SidebarPageTree",
    ()=>SidebarPageTree,
    "SidebarSeparator",
    ()=>SidebarSeparator,
    "SidebarTrigger",
    ()=>SidebarTrigger,
    "SidebarViewport",
    ()=>SidebarViewport
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-server-dom-turbopack-server.js [app-rsc] (ecmascript)");
;
const Sidebar = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call Sidebar() from the server but Sidebar is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/components/layout/sidebar.js", "Sidebar");
const SidebarCollapseTrigger = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call SidebarCollapseTrigger() from the server but SidebarCollapseTrigger is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/components/layout/sidebar.js", "SidebarCollapseTrigger");
const SidebarContent = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call SidebarContent() from the server but SidebarContent is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/components/layout/sidebar.js", "SidebarContent");
const SidebarContentMobile = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call SidebarContentMobile() from the server but SidebarContentMobile is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/components/layout/sidebar.js", "SidebarContentMobile");
const SidebarFolder = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call SidebarFolder() from the server but SidebarFolder is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/components/layout/sidebar.js", "SidebarFolder");
const SidebarFolderContent = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call SidebarFolderContent() from the server but SidebarFolderContent is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/components/layout/sidebar.js", "SidebarFolderContent");
const SidebarFolderLink = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call SidebarFolderLink() from the server but SidebarFolderLink is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/components/layout/sidebar.js", "SidebarFolderLink");
const SidebarFolderTrigger = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call SidebarFolderTrigger() from the server but SidebarFolderTrigger is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/components/layout/sidebar.js", "SidebarFolderTrigger");
const SidebarFooter = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call SidebarFooter() from the server but SidebarFooter is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/components/layout/sidebar.js", "SidebarFooter");
const SidebarHeader = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call SidebarHeader() from the server but SidebarHeader is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/components/layout/sidebar.js", "SidebarHeader");
const SidebarItem = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call SidebarItem() from the server but SidebarItem is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/components/layout/sidebar.js", "SidebarItem");
const SidebarPageTree = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call SidebarPageTree() from the server but SidebarPageTree is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/components/layout/sidebar.js", "SidebarPageTree");
const SidebarSeparator = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call SidebarSeparator() from the server but SidebarSeparator is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/components/layout/sidebar.js", "SidebarSeparator");
const SidebarTrigger = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call SidebarTrigger() from the server but SidebarTrigger is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/components/layout/sidebar.js", "SidebarTrigger");
const SidebarViewport = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call SidebarViewport() from the server but SidebarViewport is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/components/layout/sidebar.js", "SidebarViewport");
}),
"[project]/docs/node_modules/fumadocs-ui/dist/components/layout/sidebar.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$sidebar$2e$js__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__$3c$module__evaluation$3e$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-ui/dist/components/layout/sidebar.js [app-rsc] (client reference proxy) <module evaluation>");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$sidebar$2e$js__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-ui/dist/components/layout/sidebar.js [app-rsc] (client reference proxy)");
;
__turbopack_context__.n(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$sidebar$2e$js__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__);
}),
"[project]/docs/node_modules/fumadocs-ui/dist/components/layout/root-toggle.js [app-rsc] (client reference proxy) <module evaluation>", ((__turbopack_context__) => {
"use strict";

// This file is generated by next-core EcmascriptClientReferenceModule.
__turbopack_context__.s([
    "RootToggle",
    ()=>RootToggle
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-server-dom-turbopack-server.js [app-rsc] (ecmascript)");
;
const RootToggle = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call RootToggle() from the server but RootToggle is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/components/layout/root-toggle.js <module evaluation>", "RootToggle");
}),
"[project]/docs/node_modules/fumadocs-ui/dist/components/layout/root-toggle.js [app-rsc] (client reference proxy)", ((__turbopack_context__) => {
"use strict";

// This file is generated by next-core EcmascriptClientReferenceModule.
__turbopack_context__.s([
    "RootToggle",
    ()=>RootToggle
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-server-dom-turbopack-server.js [app-rsc] (ecmascript)");
;
const RootToggle = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call RootToggle() from the server but RootToggle is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/components/layout/root-toggle.js", "RootToggle");
}),
"[project]/docs/node_modules/fumadocs-ui/dist/components/layout/root-toggle.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$root$2d$toggle$2e$js__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__$3c$module__evaluation$3e$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-ui/dist/components/layout/root-toggle.js [app-rsc] (client reference proxy) <module evaluation>");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$root$2d$toggle$2e$js__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-ui/dist/components/layout/root-toggle.js [app-rsc] (client reference proxy)");
;
__turbopack_context__.n(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$root$2d$toggle$2e$js__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__);
}),
"[project]/docs/node_modules/fumadocs-ui/dist/layouts/shared/client.js [app-rsc] (client reference proxy) <module evaluation>", ((__turbopack_context__) => {
"use strict";

// This file is generated by next-core EcmascriptClientReferenceModule.
__turbopack_context__.s([
    "BaseLinkItem",
    ()=>BaseLinkItem
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-server-dom-turbopack-server.js [app-rsc] (ecmascript)");
;
const BaseLinkItem = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call BaseLinkItem() from the server but BaseLinkItem is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/layouts/shared/client.js <module evaluation>", "BaseLinkItem");
}),
"[project]/docs/node_modules/fumadocs-ui/dist/layouts/shared/client.js [app-rsc] (client reference proxy)", ((__turbopack_context__) => {
"use strict";

// This file is generated by next-core EcmascriptClientReferenceModule.
__turbopack_context__.s([
    "BaseLinkItem",
    ()=>BaseLinkItem
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-server-dom-turbopack-server.js [app-rsc] (ecmascript)");
;
const BaseLinkItem = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call BaseLinkItem() from the server but BaseLinkItem is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/layouts/shared/client.js", "BaseLinkItem");
}),
"[project]/docs/node_modules/fumadocs-ui/dist/layouts/shared/client.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$layouts$2f$shared$2f$client$2e$js__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__$3c$module__evaluation$3e$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-ui/dist/layouts/shared/client.js [app-rsc] (client reference proxy) <module evaluation>");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$layouts$2f$shared$2f$client$2e$js__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-ui/dist/layouts/shared/client.js [app-rsc] (client reference proxy)");
;
__turbopack_context__.n(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$layouts$2f$shared$2f$client$2e$js__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__);
}),
"[project]/docs/node_modules/fumadocs-ui/dist/layouts/shared/index.js [app-rsc] (ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getLinks",
    ()=>getLinks
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-jsx-runtime.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$layouts$2f$shared$2f$client$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-ui/dist/layouts/shared/client.js [app-rsc] (ecmascript)");
;
function getLinks(links = [], githubUrl) {
    let result = links ?? [];
    if (githubUrl) result = [
        ...result,
        {
            type: 'icon',
            url: githubUrl,
            text: 'Github',
            label: 'GitHub',
            icon: (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsx"])("svg", {
                role: "img",
                viewBox: "0 0 24 24",
                fill: "currentColor",
                children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsx"])("path", {
                    d: "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
                })
            }),
            external: true
        }
    ];
    return result;
}
;
}),
"[project]/docs/node_modules/fumadocs-ui/dist/components/layout/language-toggle.js [app-rsc] (client reference proxy) <module evaluation>", ((__turbopack_context__) => {
"use strict";

// This file is generated by next-core EcmascriptClientReferenceModule.
__turbopack_context__.s([
    "LanguageToggle",
    ()=>LanguageToggle,
    "LanguageToggleText",
    ()=>LanguageToggleText
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-server-dom-turbopack-server.js [app-rsc] (ecmascript)");
;
const LanguageToggle = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call LanguageToggle() from the server but LanguageToggle is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/components/layout/language-toggle.js <module evaluation>", "LanguageToggle");
const LanguageToggleText = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call LanguageToggleText() from the server but LanguageToggleText is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/components/layout/language-toggle.js <module evaluation>", "LanguageToggleText");
}),
"[project]/docs/node_modules/fumadocs-ui/dist/components/layout/language-toggle.js [app-rsc] (client reference proxy)", ((__turbopack_context__) => {
"use strict";

// This file is generated by next-core EcmascriptClientReferenceModule.
__turbopack_context__.s([
    "LanguageToggle",
    ()=>LanguageToggle,
    "LanguageToggleText",
    ()=>LanguageToggleText
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-server-dom-turbopack-server.js [app-rsc] (ecmascript)");
;
const LanguageToggle = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call LanguageToggle() from the server but LanguageToggle is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/components/layout/language-toggle.js", "LanguageToggle");
const LanguageToggleText = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call LanguageToggleText() from the server but LanguageToggleText is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/components/layout/language-toggle.js", "LanguageToggleText");
}),
"[project]/docs/node_modules/fumadocs-ui/dist/components/layout/language-toggle.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$language$2d$toggle$2e$js__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__$3c$module__evaluation$3e$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-ui/dist/components/layout/language-toggle.js [app-rsc] (client reference proxy) <module evaluation>");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$language$2d$toggle$2e$js__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-ui/dist/components/layout/language-toggle.js [app-rsc] (client reference proxy)");
;
__turbopack_context__.n(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$language$2d$toggle$2e$js__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__);
}),
"[project]/docs/node_modules/fumadocs-ui/dist/layouts/docs/client.js [app-rsc] (client reference proxy) <module evaluation>", ((__turbopack_context__) => {
"use strict";

// This file is generated by next-core EcmascriptClientReferenceModule.
__turbopack_context__.s([
    "CollapsibleControl",
    ()=>CollapsibleControl,
    "LayoutBody",
    ()=>LayoutBody,
    "LayoutTabs",
    ()=>LayoutTabs,
    "Navbar",
    ()=>Navbar
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-server-dom-turbopack-server.js [app-rsc] (ecmascript)");
;
const CollapsibleControl = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call CollapsibleControl() from the server but CollapsibleControl is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/layouts/docs/client.js <module evaluation>", "CollapsibleControl");
const LayoutBody = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call LayoutBody() from the server but LayoutBody is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/layouts/docs/client.js <module evaluation>", "LayoutBody");
const LayoutTabs = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call LayoutTabs() from the server but LayoutTabs is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/layouts/docs/client.js <module evaluation>", "LayoutTabs");
const Navbar = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call Navbar() from the server but Navbar is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/layouts/docs/client.js <module evaluation>", "Navbar");
}),
"[project]/docs/node_modules/fumadocs-ui/dist/layouts/docs/client.js [app-rsc] (client reference proxy)", ((__turbopack_context__) => {
"use strict";

// This file is generated by next-core EcmascriptClientReferenceModule.
__turbopack_context__.s([
    "CollapsibleControl",
    ()=>CollapsibleControl,
    "LayoutBody",
    ()=>LayoutBody,
    "LayoutTabs",
    ()=>LayoutTabs,
    "Navbar",
    ()=>Navbar
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-server-dom-turbopack-server.js [app-rsc] (ecmascript)");
;
const CollapsibleControl = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call CollapsibleControl() from the server but CollapsibleControl is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/layouts/docs/client.js", "CollapsibleControl");
const LayoutBody = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call LayoutBody() from the server but LayoutBody is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/layouts/docs/client.js", "LayoutBody");
const LayoutTabs = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call LayoutTabs() from the server but LayoutTabs is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/layouts/docs/client.js", "LayoutTabs");
const Navbar = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call Navbar() from the server but Navbar is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/layouts/docs/client.js", "Navbar");
}),
"[project]/docs/node_modules/fumadocs-ui/dist/layouts/docs/client.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$layouts$2f$docs$2f$client$2e$js__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__$3c$module__evaluation$3e$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-ui/dist/layouts/docs/client.js [app-rsc] (client reference proxy) <module evaluation>");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$layouts$2f$docs$2f$client$2e$js__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-ui/dist/layouts/docs/client.js [app-rsc] (client reference proxy)");
;
__turbopack_context__.n(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$layouts$2f$docs$2f$client$2e$js__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__);
}),
"[project]/docs/node_modules/fumadocs-ui/dist/contexts/tree.js [app-rsc] (client reference proxy) <module evaluation>", ((__turbopack_context__) => {
"use strict";

// This file is generated by next-core EcmascriptClientReferenceModule.
__turbopack_context__.s([
    "TreeContextProvider",
    ()=>TreeContextProvider,
    "useTreeContext",
    ()=>useTreeContext,
    "useTreePath",
    ()=>useTreePath
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-server-dom-turbopack-server.js [app-rsc] (ecmascript)");
;
const TreeContextProvider = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call TreeContextProvider() from the server but TreeContextProvider is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/contexts/tree.js <module evaluation>", "TreeContextProvider");
const useTreeContext = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call useTreeContext() from the server but useTreeContext is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/contexts/tree.js <module evaluation>", "useTreeContext");
const useTreePath = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call useTreePath() from the server but useTreePath is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/contexts/tree.js <module evaluation>", "useTreePath");
}),
"[project]/docs/node_modules/fumadocs-ui/dist/contexts/tree.js [app-rsc] (client reference proxy)", ((__turbopack_context__) => {
"use strict";

// This file is generated by next-core EcmascriptClientReferenceModule.
__turbopack_context__.s([
    "TreeContextProvider",
    ()=>TreeContextProvider,
    "useTreeContext",
    ()=>useTreeContext,
    "useTreePath",
    ()=>useTreePath
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-server-dom-turbopack-server.js [app-rsc] (ecmascript)");
;
const TreeContextProvider = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call TreeContextProvider() from the server but TreeContextProvider is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/contexts/tree.js", "TreeContextProvider");
const useTreeContext = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call useTreeContext() from the server but useTreeContext is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/contexts/tree.js", "useTreeContext");
const useTreePath = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call useTreePath() from the server but useTreePath is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/contexts/tree.js", "useTreePath");
}),
"[project]/docs/node_modules/fumadocs-ui/dist/contexts/tree.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$contexts$2f$tree$2e$js__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__$3c$module__evaluation$3e$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-ui/dist/contexts/tree.js [app-rsc] (client reference proxy) <module evaluation>");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$contexts$2f$tree$2e$js__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-ui/dist/contexts/tree.js [app-rsc] (client reference proxy)");
;
__turbopack_context__.n(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$contexts$2f$tree$2e$js__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__);
}),
"[project]/docs/node_modules/fumadocs-ui/dist/components/layout/theme-toggle.js [app-rsc] (client reference proxy) <module evaluation>", ((__turbopack_context__) => {
"use strict";

// This file is generated by next-core EcmascriptClientReferenceModule.
__turbopack_context__.s([
    "ThemeToggle",
    ()=>ThemeToggle
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-server-dom-turbopack-server.js [app-rsc] (ecmascript)");
;
const ThemeToggle = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call ThemeToggle() from the server but ThemeToggle is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/components/layout/theme-toggle.js <module evaluation>", "ThemeToggle");
}),
"[project]/docs/node_modules/fumadocs-ui/dist/components/layout/theme-toggle.js [app-rsc] (client reference proxy)", ((__turbopack_context__) => {
"use strict";

// This file is generated by next-core EcmascriptClientReferenceModule.
__turbopack_context__.s([
    "ThemeToggle",
    ()=>ThemeToggle
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-server-dom-turbopack-server.js [app-rsc] (ecmascript)");
;
const ThemeToggle = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call ThemeToggle() from the server but ThemeToggle is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/components/layout/theme-toggle.js", "ThemeToggle");
}),
"[project]/docs/node_modules/fumadocs-ui/dist/components/layout/theme-toggle.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$theme$2d$toggle$2e$js__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__$3c$module__evaluation$3e$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-ui/dist/components/layout/theme-toggle.js [app-rsc] (client reference proxy) <module evaluation>");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$theme$2d$toggle$2e$js__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-ui/dist/components/layout/theme-toggle.js [app-rsc] (client reference proxy)");
;
__turbopack_context__.n(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$theme$2d$toggle$2e$js__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__);
}),
"[project]/docs/node_modules/fumadocs-ui/dist/contexts/layout.js [app-rsc] (client reference proxy) <module evaluation>", ((__turbopack_context__) => {
"use strict";

// This file is generated by next-core EcmascriptClientReferenceModule.
__turbopack_context__.s([
    "NavProvider",
    ()=>NavProvider,
    "StylesProvider",
    ()=>StylesProvider,
    "useNav",
    ()=>useNav,
    "usePageStyles",
    ()=>usePageStyles
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-server-dom-turbopack-server.js [app-rsc] (ecmascript)");
;
const NavProvider = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call NavProvider() from the server but NavProvider is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/contexts/layout.js <module evaluation>", "NavProvider");
const StylesProvider = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call StylesProvider() from the server but StylesProvider is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/contexts/layout.js <module evaluation>", "StylesProvider");
const useNav = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call useNav() from the server but useNav is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/contexts/layout.js <module evaluation>", "useNav");
const usePageStyles = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call usePageStyles() from the server but usePageStyles is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/contexts/layout.js <module evaluation>", "usePageStyles");
}),
"[project]/docs/node_modules/fumadocs-ui/dist/contexts/layout.js [app-rsc] (client reference proxy)", ((__turbopack_context__) => {
"use strict";

// This file is generated by next-core EcmascriptClientReferenceModule.
__turbopack_context__.s([
    "NavProvider",
    ()=>NavProvider,
    "StylesProvider",
    ()=>StylesProvider,
    "useNav",
    ()=>useNav,
    "usePageStyles",
    ()=>usePageStyles
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-server-dom-turbopack-server.js [app-rsc] (ecmascript)");
;
const NavProvider = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call NavProvider() from the server but NavProvider is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/contexts/layout.js", "NavProvider");
const StylesProvider = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call StylesProvider() from the server but StylesProvider is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/contexts/layout.js", "StylesProvider");
const useNav = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call useNav() from the server but useNav is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/contexts/layout.js", "useNav");
const usePageStyles = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call usePageStyles() from the server but usePageStyles is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/contexts/layout.js", "usePageStyles");
}),
"[project]/docs/node_modules/fumadocs-ui/dist/contexts/layout.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$contexts$2f$layout$2e$js__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__$3c$module__evaluation$3e$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-ui/dist/contexts/layout.js [app-rsc] (client reference proxy) <module evaluation>");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$contexts$2f$layout$2e$js__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-ui/dist/contexts/layout.js [app-rsc] (client reference proxy)");
;
__turbopack_context__.n(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$contexts$2f$layout$2e$js__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__);
}),
"[project]/docs/node_modules/fumadocs-ui/dist/components/layout/search-toggle.js [app-rsc] (client reference proxy) <module evaluation>", ((__turbopack_context__) => {
"use strict";

// This file is generated by next-core EcmascriptClientReferenceModule.
__turbopack_context__.s([
    "LargeSearchToggle",
    ()=>LargeSearchToggle,
    "SearchToggle",
    ()=>SearchToggle
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-server-dom-turbopack-server.js [app-rsc] (ecmascript)");
;
const LargeSearchToggle = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call LargeSearchToggle() from the server but LargeSearchToggle is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/components/layout/search-toggle.js <module evaluation>", "LargeSearchToggle");
const SearchToggle = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call SearchToggle() from the server but SearchToggle is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/components/layout/search-toggle.js <module evaluation>", "SearchToggle");
}),
"[project]/docs/node_modules/fumadocs-ui/dist/components/layout/search-toggle.js [app-rsc] (client reference proxy)", ((__turbopack_context__) => {
"use strict";

// This file is generated by next-core EcmascriptClientReferenceModule.
__turbopack_context__.s([
    "LargeSearchToggle",
    ()=>LargeSearchToggle,
    "SearchToggle",
    ()=>SearchToggle
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-server-dom-turbopack-server.js [app-rsc] (ecmascript)");
;
const LargeSearchToggle = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call LargeSearchToggle() from the server but LargeSearchToggle is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/components/layout/search-toggle.js", "LargeSearchToggle");
const SearchToggle = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call SearchToggle() from the server but SearchToggle is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/docs/node_modules/fumadocs-ui/dist/components/layout/search-toggle.js", "SearchToggle");
}),
"[project]/docs/node_modules/fumadocs-ui/dist/components/layout/search-toggle.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$search$2d$toggle$2e$js__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__$3c$module__evaluation$3e$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-ui/dist/components/layout/search-toggle.js [app-rsc] (client reference proxy) <module evaluation>");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$search$2d$toggle$2e$js__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-ui/dist/components/layout/search-toggle.js [app-rsc] (client reference proxy)");
;
__turbopack_context__.n(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$search$2d$toggle$2e$js__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__);
}),
"[project]/docs/node_modules/fumadocs-ui/dist/utils/get-sidebar-tabs.js [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getSidebarTabs",
    ()=>getSidebarTabs
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-jsx-runtime.js [app-rsc] (ecmascript)");
;
const defaultTransform = (option, node)=>{
    if (!node.icon) return option;
    return {
        ...option,
        icon: (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsx"])("div", {
            className: "size-full [&_svg]:size-full max-md:p-1.5 max-md:rounded-md max-md:border max-md:bg-fd-secondary",
            children: node.icon
        })
    };
};
function getSidebarTabs(tree, { transform = defaultTransform } = {}) {
    const results = [];
    function scanOptions(node, unlisted) {
        if ('root' in node && node.root) {
            const urls = getFolderUrls(node);
            if (urls.size > 0) {
                const option = {
                    url: urls.values().next().value ?? '',
                    title: node.name,
                    icon: node.icon,
                    unlisted,
                    description: node.description,
                    urls
                };
                const mapped = transform ? transform(option, node) : option;
                if (mapped) results.push(mapped);
            }
        }
        for (const child of node.children){
            if (child.type === 'folder') scanOptions(child, unlisted);
        }
    }
    scanOptions(tree);
    if (tree.fallback) scanOptions(tree.fallback, true);
    return results;
}
function getFolderUrls(folder, output = new Set()) {
    if (folder.index) output.add(folder.index.url);
    for (const child of folder.children){
        if (child.type === 'page' && !child.external) output.add(child.url);
        if (child.type === 'folder') getFolderUrls(child, output);
    }
    return output;
}
}),
"[project]/docs/node_modules/fumadocs-ui/dist/layouts/docs/index.js [app-rsc] (ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "DocsLayout",
    ()=>DocsLayout
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-jsx-runtime.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$icons$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-ui/dist/icons.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$utils$2f$cn$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-ui/dist/utils/cn.js [app-rsc] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$tailwind$2d$merge$2f$dist$2f$bundle$2d$mjs$2e$mjs__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__twMerge__as__cn$3e$__ = __turbopack_context__.i("[project]/docs/node_modules/tailwind-merge/dist/bundle-mjs.mjs [app-rsc] (ecmascript) <export twMerge as cn>");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$ui$2f$button$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-ui/dist/components/ui/button.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$sidebar$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-ui/dist/components/layout/sidebar.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$root$2d$toggle$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-ui/dist/components/layout/root-toggle.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$layouts$2f$shared$2f$index$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-ui/dist/layouts/shared/index.js [app-rsc] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$layouts$2f$shared$2f$client$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-ui/dist/layouts/shared/client.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$language$2d$toggle$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-ui/dist/components/layout/language-toggle.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$layouts$2f$docs$2f$client$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-ui/dist/layouts/docs/client.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$contexts$2f$tree$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-ui/dist/contexts/tree.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$theme$2d$toggle$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-ui/dist/components/layout/theme-toggle.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$contexts$2f$layout$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-ui/dist/contexts/layout.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$link$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-core/dist/link.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$search$2d$toggle$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-ui/dist/components/layout/search-toggle.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$utils$2f$get$2d$sidebar$2d$tabs$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/docs/node_modules/fumadocs-ui/dist/utils/get-sidebar-tabs.js [app-rsc] (ecmascript)");
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
function DocsLayout({ nav: { transparentMode, ...nav } = {}, sidebar: { tabs: sidebarTabs, enabled: sidebarEnabled = true, ...sidebarProps } = {}, searchToggle = {}, themeSwitch = {}, tabMode = 'auto', i18n = false, children, tree, ...props }) {
    const tabs = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["useMemo"])(()=>{
        if (Array.isArray(sidebarTabs)) {
            return sidebarTabs;
        }
        if (typeof sidebarTabs === 'object') {
            return (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$utils$2f$get$2d$sidebar$2d$tabs$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["getSidebarTabs"])(tree, sidebarTabs);
        }
        if (sidebarTabs !== false) {
            return (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$utils$2f$get$2d$sidebar$2d$tabs$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["getSidebarTabs"])(tree);
        }
        return [];
    }, [
        tree,
        sidebarTabs
    ]);
    const links = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$layouts$2f$shared$2f$index$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$locals$3e$__["getLinks"])(props.links ?? [], props.githubUrl);
    const sidebarVariables = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$tailwind$2d$merge$2f$dist$2f$bundle$2d$mjs$2e$mjs__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__twMerge__as__cn$3e$__["cn"])('md:[--fd-sidebar-width:268px] lg:[--fd-sidebar-width:286px]');
    function sidebar() {
        const { footer, banner, collapsible = true, component, components, defaultOpenLevel, prefetch, ...rest } = sidebarProps;
        if (component) return component;
        const iconLinks = links.filter((item)=>item.type === 'icon');
        const viewport = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxs"])(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$sidebar$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["SidebarViewport"], {
            children: [
                links.filter((v)=>v.type !== 'icon').map((item, i, list)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsx"])(SidebarLinkItem, {
                        item: item,
                        className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$tailwind$2d$merge$2f$dist$2f$bundle$2d$mjs$2e$mjs__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__twMerge__as__cn$3e$__["cn"])(i === list.length - 1 && 'mb-4')
                    }, i)),
                (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsx"])(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$sidebar$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["SidebarPageTree"], {
                    components: components
                })
            ]
        });
        const mobile = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxs"])(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$sidebar$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["SidebarContentMobile"], {
            ...rest,
            children: [
                (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxs"])(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$sidebar$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["SidebarHeader"], {
                    children: [
                        (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                            className: "flex text-fd-muted-foreground items-center gap-1.5",
                            children: [
                                (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsx"])("div", {
                                    className: "flex flex-1",
                                    children: iconLinks.map((item, i)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsx"])(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$layouts$2f$shared$2f$client$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["BaseLinkItem"], {
                                            item: item,
                                            className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$tailwind$2d$merge$2f$dist$2f$bundle$2d$mjs$2e$mjs__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__twMerge__as__cn$3e$__["cn"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$ui$2f$button$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["buttonVariants"])({
                                                size: 'icon-sm',
                                                color: 'ghost',
                                                className: 'p-2'
                                            })),
                                            "aria-label": item.label,
                                            children: item.icon
                                        }, i))
                                }),
                                i18n ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxs"])(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$language$2d$toggle$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["LanguageToggle"], {
                                    children: [
                                        (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsx"])(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$icons$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["Languages"], {
                                            className: "size-4.5"
                                        }),
                                        (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsx"])(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$language$2d$toggle$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["LanguageToggleText"], {})
                                    ]
                                }) : null,
                                themeSwitch.enabled !== false && (themeSwitch.component ?? (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsx"])(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$theme$2d$toggle$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["ThemeToggle"], {
                                    className: "p-0",
                                    mode: themeSwitch.mode
                                })),
                                (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsx"])(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$sidebar$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["SidebarTrigger"], {
                                    className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$tailwind$2d$merge$2f$dist$2f$bundle$2d$mjs$2e$mjs__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__twMerge__as__cn$3e$__["cn"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$ui$2f$button$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["buttonVariants"])({
                                        color: 'ghost',
                                        size: 'icon-sm',
                                        className: 'p-2'
                                    })),
                                    children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsx"])(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$icons$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["Sidebar"], {})
                                })
                            ]
                        }),
                        tabs.length > 0 && (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsx"])(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$root$2d$toggle$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["RootToggle"], {
                            options: tabs
                        }),
                        banner
                    ]
                }),
                viewport,
                (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsx"])(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$sidebar$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["SidebarFooter"], {
                    className: "empty:hidden",
                    children: footer
                })
            ]
        });
        const content = (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxs"])(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$sidebar$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["SidebarContent"], {
            ...rest,
            children: [
                (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxs"])(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$sidebar$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["SidebarHeader"], {
                    children: [
                        (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                            className: "flex",
                            children: [
                                (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsx"])(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$link$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["default"], {
                                    href: nav.url ?? '/',
                                    className: "inline-flex text-[0.9375rem] items-center gap-2.5 font-medium me-auto",
                                    children: nav.title
                                }),
                                nav.children,
                                collapsible && (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsx"])(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$sidebar$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["SidebarCollapseTrigger"], {
                                    className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$tailwind$2d$merge$2f$dist$2f$bundle$2d$mjs$2e$mjs__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__twMerge__as__cn$3e$__["cn"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$ui$2f$button$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["buttonVariants"])({
                                        color: 'ghost',
                                        size: 'icon-sm',
                                        className: 'mb-auto text-fd-muted-foreground'
                                    })),
                                    children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsx"])(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$icons$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["Sidebar"], {})
                                })
                            ]
                        }),
                        searchToggle.enabled !== false && (searchToggle.components?.lg ?? (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsx"])(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$search$2d$toggle$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["LargeSearchToggle"], {
                            hideIfDisabled: true
                        })),
                        tabs.length > 0 && tabMode === 'auto' && (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsx"])(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$root$2d$toggle$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["RootToggle"], {
                            options: tabs
                        }),
                        banner
                    ]
                }),
                viewport,
                (i18n || iconLinks.length > 0 || themeSwitch?.enabled !== false || footer) && (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxs"])(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$sidebar$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["SidebarFooter"], {
                    children: [
                        (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxs"])("div", {
                            className: "flex text-fd-muted-foreground items-center empty:hidden",
                            children: [
                                i18n && (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsx"])(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$language$2d$toggle$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["LanguageToggle"], {
                                    children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsx"])(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$icons$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["Languages"], {
                                        className: "size-4.5"
                                    })
                                }),
                                iconLinks.map((item, i)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsx"])(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$layouts$2f$shared$2f$client$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["BaseLinkItem"], {
                                        item: item,
                                        className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$tailwind$2d$merge$2f$dist$2f$bundle$2d$mjs$2e$mjs__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__twMerge__as__cn$3e$__["cn"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$ui$2f$button$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["buttonVariants"])({
                                            size: 'icon-sm',
                                            color: 'ghost'
                                        })),
                                        "aria-label": item.label,
                                        children: item.icon
                                    }, i)),
                                themeSwitch.enabled !== false && (themeSwitch.component ?? (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsx"])(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$theme$2d$toggle$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["ThemeToggle"], {
                                    className: "ms-auto p-0",
                                    mode: themeSwitch.mode
                                }))
                            ]
                        }),
                        footer
                    ]
                })
            ]
        });
        return (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsx"])(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$sidebar$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["Sidebar"], {
            defaultOpenLevel: defaultOpenLevel,
            prefetch: prefetch,
            Mobile: mobile,
            Content: (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxs"])(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["Fragment"], {
                children: [
                    collapsible && (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsx"])(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$layouts$2f$docs$2f$client$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["CollapsibleControl"], {}),
                    content
                ]
            })
        });
    }
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsx"])(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$contexts$2f$tree$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["TreeContextProvider"], {
        tree: tree,
        children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxs"])(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$contexts$2f$layout$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["NavProvider"], {
            transparentMode: transparentMode,
            children: [
                nav.enabled !== false && (nav.component ?? (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxs"])(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$layouts$2f$docs$2f$client$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["Navbar"], {
                    className: "h-(--fd-nav-height) on-root:[--fd-nav-height:56px] md:on-root:[--fd-nav-height:0px] md:hidden",
                    children: [
                        (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsx"])(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$core$2f$dist$2f$link$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["default"], {
                            href: nav.url ?? '/',
                            className: "inline-flex items-center gap-2.5 font-semibold",
                            children: nav.title
                        }),
                        (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsx"])("div", {
                            className: "flex-1",
                            children: nav.children
                        }),
                        searchToggle.enabled !== false && (searchToggle.components?.sm ?? (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsx"])(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$search$2d$toggle$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["SearchToggle"], {
                            className: "p-2",
                            hideIfDisabled: true
                        })),
                        sidebarEnabled && (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsx"])(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$sidebar$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["SidebarTrigger"], {
                            className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$tailwind$2d$merge$2f$dist$2f$bundle$2d$mjs$2e$mjs__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__twMerge__as__cn$3e$__["cn"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$ui$2f$button$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["buttonVariants"])({
                                color: 'ghost',
                                size: 'icon-sm',
                                className: 'p-2'
                            })),
                            children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsx"])(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$icons$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["Sidebar"], {})
                        })
                    ]
                })),
                (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxs"])(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$layouts$2f$docs$2f$client$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["LayoutBody"], {
                    ...props.containerProps,
                    className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$tailwind$2d$merge$2f$dist$2f$bundle$2d$mjs$2e$mjs__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__twMerge__as__cn$3e$__["cn"])('md:[&_#nd-page_article]:pt-12 xl:[&_#nd-page_article]:px-8', sidebarEnabled && sidebarVariables, props.containerProps?.className),
                    children: [
                        sidebarEnabled && sidebar(),
                        tabMode === 'top' && tabs.length > 0 && (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsx"])(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$layouts$2f$docs$2f$client$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["LayoutTabs"], {
                            options: tabs,
                            className: "sticky top-[calc(var(--fd-nav-height)+var(--fd-tocnav-height))] z-10 bg-fd-background border-b px-6 pt-3 xl:px-8 max-md:hidden"
                        }),
                        children
                    ]
                })
            ]
        })
    });
}
function SidebarLinkItem({ item, ...props }) {
    if (item.type === 'menu') return (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxs"])(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$sidebar$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["SidebarFolder"], {
        ...props,
        children: [
            item.url ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxs"])(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$sidebar$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["SidebarFolderLink"], {
                href: item.url,
                external: item.external,
                children: [
                    item.icon,
                    item.text
                ]
            }) : (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxs"])(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$sidebar$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["SidebarFolderTrigger"], {
                children: [
                    item.icon,
                    item.text
                ]
            }),
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsx"])(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$sidebar$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["SidebarFolderContent"], {
                children: item.items.map((child, i)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsx"])(SidebarLinkItem, {
                        item: child
                    }, i))
            })
        ]
    });
    if (item.type === 'custom') return (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsx"])("div", {
        ...props,
        children: item.children
    });
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsx"])(__TURBOPACK__imported__module__$5b$project$5d2f$docs$2f$node_modules$2f$fumadocs$2d$ui$2f$dist$2f$components$2f$layout$2f$sidebar$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["SidebarItem"], {
        href: item.url,
        icon: item.icon,
        external: item.external,
        ...props,
        children: item.text
    });
}
;
}),
];

//# sourceMappingURL=126f3_fumadocs-ui_dist_c69c0dd4._.js.map
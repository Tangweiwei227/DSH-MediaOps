# Third-party notices

DSH-MediaOps vendors the complete skill corpus from [ZJU-REAL/Easel](https://github.com/ZJU-REAL/Easel), source snapshot `660dfd2b75d10bea48f57be22d8da694f88851b8`. Easel is distributed under the Apache License 2.0. The original skill files, including their per-skill `EASEL-META.md` provenance records, are retained under `skills/openclaw/`.

## Important license status

This document preserves Easel's upstream acknowledgments; it is not a legal conclusion about any third-party work. The relationship to a cited source varies by skill: some implementations were adapted, some only reference a design or public methodology, and some invoke a separately installed dependency or commercial service. A citation does not mean that source code from every listed project is bundled.

The 43 reference-project entries inherited from Easel have **not** been individually license-verified. Most are methodological references or separately installed/runtime dependencies and their source code is not included in this npm package merely because it is named here. Two identifiable vendored sources are called out separately below with complete MIT license texts. Several `EASEL-META.md` files explicitly mark other upstream license information as **“待核实” (verification pending)**. Before redistributing extracted skill material or installing optional runtime dependencies, review the applicable metadata, current license, and service terms. In particular:

- FFmpeg licensing can be LGPL or GPL depending on the build and enabled components.
- `edge-tts` is identified in Easel metadata as GPL-3.0; RNNoise as BSD; Pillow under its HPND/MIT-CMU-style license.
- `biliup` and other external publishing, browser automation, model, API, or command-line components have independent licenses or service terms.
- DashScope, Suno-like providers, video-generation services, Microsoft Edge online TTS, and social platforms are external services whose use is governed by their own terms.
- References to commercial products and academic work below are methodological acknowledgments, not a grant of rights to those products or publications.

All names, trademarks, and copyrights belong to their respective owners. No endorsement is implied.

## Easel and attribution chain

| Work | Relationship | Notice |
|---|---|---|
| [ZJU-REAL/Easel](https://github.com/ZJU-REAL/Easel) | Source of the 112 bundled skills and shared resources | Apache License 2.0; Easel and its contributors retain applicable rights |
| DSH-MediaOps | DSH packaging, orchestration, and AI-native interaction layer | See this repository's `LICENSE` and `NOTICE` |

## Vendored MIT-licensed skill sources

The following source is present in the bundled skill tree rather than merely referenced:

| Work | Bundled location | License |
|---|---|---|
| [lucasygu/redbook](https://github.com/lucasygu/redbook) | `skills/openclaw/skill-xhs-analyzer/` | MIT; Copyright (c) 2026 Lucas Gu; full text in `third_party_licenses/lucasygu-redbook-LICENSE` |
| [white0dew/XiaohongshuSkills](https://github.com/white0dew/XiaohongshuSkills) | `skills/openclaw/skill-xhs-publisher/` (including retained metadata/assets; publishing implementation has subsequently been rewritten) | MIT; Copyright (c) 2026 angiin; full text in `third_party_licenses/white0dew-XiaohongshuSkills-LICENSE` |

All remaining tables below are attribution/reference records inherited from Easel. Unless an entry is explicitly identified as vendored above, listing it does not mean its source code is shipped in this package.

## Visual, card, chart, and asset references

| Project | Referenced by Easel skills |
|---|---|
| [nexu-io/open-design](https://github.com/nexu-io/open-design) | `card-quote`, `card-xiaohongshu` |
| [antvis/GPT-Vis](https://github.com/antvis/GPT-Vis) | `chart-visualization`, `infographic` |
| [danpeig/product-compare-matrix-generator](https://github.com/danpeig/product-compare-matrix-generator) | `comparison-card` |
| [dostogircse171/solvyy-comparison-table](https://github.com/dostogircse171/solvyy-comparison-table) | `comparison-card` |
| [codyhouse/products-comparison-table](https://github.com/codyhouse/products-comparison-table) | `comparison-card` |
| [GreyCat/comparison-table-generator](https://github.com/GreyCat/comparison-table-generator) | `comparison-card` |
| [unopim/unopim-digital-asset-management](https://github.com/unopim/unopim-digital-asset-management) | `asset-manager` |
| [biagiomaf/smart-comfyui-gallery](https://github.com/biagiomaf/smart-comfyui-gallery) | `asset-manager` |
| [enescingoz/awesome-n8n-templates](https://github.com/enescingoz/awesome-n8n-templates) | `template-library` |
| [danielmiessler/fabric](https://github.com/danielmiessler/fabric) | `template-library` |
| [liangdabiao/ecom-details-image](https://github.com/liangdabiao/ecom-details-image) | `ecom-details-image` |

## Writing, voice, and content references

| Project | Referenced by Easel skills |
|---|---|
| [langgptai/LangGPT](https://github.com/langgptai/LangGPT) | `post-formatter` |
| [kangarooking/system-prompt-skills](https://github.com/kangarooking/system-prompt-skills) | `post-formatter` |
| [MrGeDiao/shuorenhua](https://github.com/MrGeDiao/shuorenhua) | `post-formatter`, `text-polisher` |
| [charlie947/social-media-skills](https://github.com/charlie947/social-media-skills) | `post-formatter`, `voice-builder`, `profile-manager` |
| [omeyazic/ai-voice-capture-framework](https://github.com/omeyazic/ai-voice-capture-framework) | `voice-builder` |
| [angelarose210/ghostwriter](https://github.com/angelarose210/ghostwriter) | `voice-builder` |
| [danielrosehill/My-Tone-Of-Voice](https://github.com/danielrosehill/My-Tone-Of-Voice) | `voice-builder` |
| [jaimeschwarz/brandvoice](https://github.com/jaimeschwarz/brandvoice) | `voice-builder` |
| [comp-int-hum/llm-style-transfer](https://github.com/comp-int-hum/llm-style-transfer) | `style-transfer` |
| [fuzhenxin/Style-Transfer-in-Text](https://github.com/fuzhenxin/Style-Transfer-in-Text) | `style-transfer` |
| [souro/tst_llm](https://github.com/souro/tst_llm) | `style-transfer` |
| [praj2408/Text-Summarizer-Project](https://github.com/praj2408/Text-Summarizer-Project) | `text-condenser` |
| [Huzaifa785/context-compressor](https://github.com/Huzaifa785/context-compressor) | `text-condenser` |
| [neopunisher/Open-Text-Summarizer](https://github.com/neopunisher/Open-Text-Summarizer) | `text-condenser` |
| [mathsyouth/awesome-text-summarization](https://github.com/mathsyouth/awesome-text-summarization) | `text-condenser` |
| [nashsu/Viral_Writer_Skill](https://github.com/nashsu/Viral_Writer_Skill) | `social-content` |
| [maomao52088/xiaohongshu-automation-skills](https://github.com/maomao52088/xiaohongshu-automation-skills) | `social-content` |
| [op7418/guizang-social-card-skill](https://github.com/op7418/guizang-social-card-skill) | `social-content`; also identified as a design-method reference by `card-design` |
| [JuneYaooo/xhs-writer-skill](https://github.com/JuneYaooo/xhs-writer-skill) | `social-content` |
| [chubbyguan/chubbyskills](https://github.com/chubbyguan/chubbyskills) | `social-content` |
| [vivy-yi/xiaohongshu-skills](https://github.com/vivy-yi/xiaohongshu-skills) | `social-content` |

## Audio and video references

| Project | Referenced by Easel skills |
|---|---|
| [xiph/rnnoise](https://github.com/xiph/rnnoise) | `audio-denoise` |
| [GregorR/rnnoise-models](https://github.com/GregorR/rnnoise-models) | `audio-denoise` |
| [timsainb/noisereduce](https://github.com/timsainb/noisereduce) | `audio-denoise` |
| [louisedesadeleer/clipify](https://github.com/louisedesadeleer/clipify) | `clipify` |

## Publishing and data-collection references

| Project | Referenced by Easel skills |
|---|---|
| [WJZ-P/douyin-upload-mcp-skill](https://github.com/WJZ-P/douyin-upload-mcp-skill) | `skill-douyin-upload` |
| [jiji262/wechat-publisher](https://github.com/jiji262/wechat-publisher) | `skill-wechat-publisher` |
| [lucasygu/redbook](https://github.com/lucasygu/redbook) | `skill-xhs-analyzer`; vendored, see MIT notice above |
| [white0dew/XiaohongshuSkills](https://github.com/white0dew/XiaohongshuSkills) | `skill-xhs-publisher`; vendored, see MIT notice above |
| [NanmiCoder/MediaCrawler](https://github.com/NanmiCoder/MediaCrawler) | `competitor-analysis`, `content-gap-analysis`, `ugc-discovery`, `data-tracker`, `cross-platform-diff` |
| [cv-cat/Spider_XHS](https://github.com/cv-cat/Spider_XHS) | `competitor-analysis` |
| [ReaJason/xhs](https://github.com/ReaJason/xhs) | `competitor-analysis` |
| [cwjcw/xhs_douyin_content](https://github.com/cwjcw/xhs_douyin_content) | `competitor-analysis` |
| [54514382/xhs_search_comment_tool](https://github.com/54514382/xhs_search_comment_tool) | `content-gap-analysis` |
| [laiaccc/XiaohongshuAnalysis](https://github.com/laiaccc) | `cross-platform-diff`; repository address was marked pending verification by Easel |

## News and RSS references

| Project | Referenced by Easel skills |
|---|---|
| [cclank/news-aggregator-skill](https://github.com/cclank/news-aggregator-skill) | `news-intelligence` |
| [RSS-Renaissance/awesome-newsCN-feeds](https://github.com/RSS-Renaissance/awesome-newsCN-feeds) | `news-intelligence` |
| [weekend-project-space/top-rss-list](https://github.com/weekend-project-space/top-rss-list) | `news-intelligence` |
| [xiangyugongzuoliu/awesome-rss-feeds](https://github.com/xiangyugongzuoliu/awesome-rss-feeds) | `news-intelligence` |
| [SuYxh/ai-news-aggregator](https://github.com/SuYxh/ai-news-aggregator) | `news-intelligence` |
| [jwenjian/reading-list](https://github.com/jwenjian/reading-list) | `news-intelligence` |

## Attribution, strategy, and profile references

| Project | Referenced by Easel skills |
|---|---|
| [bhaskatripathi/pyviralcontent](https://github.com/bhaskatripathi/pyviralcontent) | `content-postmortem` |
| [prateekjain98/social-media-manager-skills](https://github.com/prateekjain98/social-media-manager-skills) | `profile-manager` |
| [vanities/social-skills](https://github.com/vanities/social-skills) | `profile-manager` |
| [coreyhaines31/marketingskills](https://github.com/coreyhaines31) | `strategy-advisor` |
| [blacktwist/social-media-skills](https://github.com/blacktwist) | `strategy-advisor` |
| [inovector/mixpost](https://github.com/inovector/mixpost) | `publish-checklist` |
| [trypostit/trypost](https://github.com/trypostit/trypost) | `publish-checklist` |

## Tool and algorithm references

| Project | Referenced by Easel skills |
|---|---|
| [isee15/Lunar-Solar-Calendar-Converter](https://github.com/isee15/Lunar-Solar-Calendar-Converter) | `event-calendar` |
| [jjonline/calendar.js](https://github.com/jjonline/calendar.js) | `event-calendar` |
| [yiyangcpa/Cross-Platform-Comparison](https://github.com/yiyangcpa/Cross-Platform-Comparison) | `cross-platform-diff` |

## Methodologies, products, and publications

Easel also acknowledges Newsjacking (David Meerman Scott), Google E-E-A-T, JTBD, livestream-commerce scripting patterns, and the content-pyramid method; commercial products including Metricool, Iconosquare, SocialBee, SocialBlade, Later, Mention, Brand24, Taskade, ZBrain, 新榜, 飞瓜, 蝉妈妈, 千瓜, 微播易, 克劳锐, 巨量, and 千川; and academic work on text style transfer, Douyin/TikTok comparison, and AI-content cleanup. These are cited as methodological or analytical references only.

For the most precise provenance, consult the `EASEL-META.md` stored beside each affected `SKILL.md`. When this summary and a per-skill metadata file differ, treat the per-skill file as the more specific record but independently verify any license marked pending.

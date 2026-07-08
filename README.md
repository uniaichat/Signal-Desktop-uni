<!-- Copyright 2014 Signal Messenger, LLC -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Signal Desktop

Signal Desktop links with Signal on [Android](https://github.com/signalapp/Signal-Android) or [iOS](https://github.com/signalapp/Signal-iOS) and lets you message from your Windows, macOS, and Linux computers.

[Install the production version](https://signal.org/download/) or help us out by [installing the beta version](https://support.signal.org/hc/articles/360007318471-Signal-Beta).

## Got a question?

You can find answers to a number of frequently asked questions on our [support site](https://support.signal.org/).
The [community forum](https://community.signalusers.org/) is another good place for questions.

## Found a Bug?

Please search for any [existing issues](https://github.com/signalapp/Signal-Desktop/issues) that describe your bug in order to avoid duplicate submissions.

## Have a feature request, question, comment?

Please use our community forum: https://community.signalusers.org/

## Contributing to the project

Please see [CONTRIBUTING.md](https://github.com/signalapp/Signal-Desktop/blob/main/CONTRIBUTING.md). There are lots of ways to contribute - many that don't involve code!

## Donate to Signal

You can donate to Signal from inside Signal apps (Desktop, Android, or iOS), or via the web here: [Signal Technology Foundation](https://signal.org/donate). Signal is an independent 501c3 nonprofit.

## Cryptography Notice

This distribution includes cryptographic software. The country in which you currently reside may have restrictions on the import, possession, use, and/or re-export to another country, of encryption software.
BEFORE using any encryption software, please check your country's laws, regulations and policies concerning the import, possession, or use, and re-export of encryption software, to see if this is permitted.
See <http://www.wassenaar.org/> for more information.

The U.S. Government Department of Commerce, Bureau of Industry and Security (BIS), has classified this software as Export Commodity Control Number (ECCN) 5D002.C.1, which includes information security software using or performing cryptographic functions with asymmetric algorithms.
The form and manner of this distribution makes it eligible for export under the License Exception ENC Technology Software Unrestricted (TSU) exception (see the BIS Export Administration Regulations, Section 740.13) for both object code and source code.

## License

Copyright 2013-2024 Signal Messenger, LLC

Licensed under the GNU AGPLv3: https://www.gnu.org/licenses/agpl-3.0.html


node 版本：
24.15.0 (Currently using 64-bit executable)

set VCTargetsPath=C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Microsoft\VC\v170\
set GYP_MSVS_VERSION=2022
set npm_config_arch=x64

pnpm run generate
pnpm run build-win32-all

### 打包的时候安装版本一定不能比当前打包版本高

不然会报这个错
[build:release-win32-all]   ⨯ Cannot cleanup: 
[build:release-win32-all] 
[build:release-win32-all] Error #1 --------------------------------------------------------------------------------
[build:release-win32-all] Error: Exit code: 2. Command failed: E:\work\sp\git_work\Signal-Desktop\release\signal-desktop-win-x64-8.0.3.exe
[build:release-win32-all] 
[build:release-win32-all]     at E:\work\sp\git_work\Signal-Desktop\node_modules\.pnpm\builder-util@26.0.13\node_modules\builder-util\src\util.ts:142:18
[build:release-win32-all]     at ChildProcess.exithandler (node:child_process:424:5)
[build:release-win32-all]     at ChildProcess.emit (node:events:508:28)
[build:release-win32-all]     at maybeClose (node:internal/child_process:1101:16)
[build:release-win32-all]     at Socket.<anonymous> (node:internal/child_process:457:11)
[build:release-win32-all]     at Socket.emit (node:events:508:28)
[build:release-win32-all]     at Pipe.<anonymous> (node:net:346:12)
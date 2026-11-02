# PC Emulator firmware and boot floppy

These three files are what the PC Emulator (`src/apps/vpc/Vpc.tsx`, built on
[v86](https://github.com/copy/v86)) loads at start. **None of them is covered
by this project's MIT licence.** The licence texts are in `../licenses/`.

| File | What it is | Licence | SHA-256 |
| --- | --- | --- | --- |
| `seabios.bin` | SeaBIOS rel-1.16.2, the PC BIOS | LGPL-3.0 | `73e3f359102e3a9982c35fce98eb7cd08f18303ac7f1ba6ebfbe6cdc1c244d98` |
| `vgabios.bin` | SeaVGABIOS from the same SeaBIOS build | LGPL-3.0 | `a4bc0d80cc3ca028c73dafa8fee396b8d054ce87ebd8abfbd31b06b437607880` |
| `freedos.img` | 720 KB FreeDOS boot floppy | GPL-2.0 | `9c911c52de4b2bba23d235ba8a5a34029f3e766eef8d6f0eca0c3a08fb7dfc81` |

## SeaBIOS

Copied unmodified from `bios/` in copy/v86 at commit
[`94faf3d`](https://github.com/copy/v86/tree/94faf3d/bios), the commit the
`v86@0.5.471` npm package is built from. Source: tag `rel-1.16.2` of
<https://git.seabios.org/seabios.git>, built with
[`seabios.config`](https://github.com/copy/v86/blob/94faf3d/bios/seabios.config)
by [`fetch-and-build-seabios.sh`](https://github.com/copy/v86/blob/94faf3d/bios/fetch-and-build-seabios.sh).

## FreeDOS floppy

Made by `scripts/make-freedos.mjs` from <https://i.copy.sh/freedos722.img>
(SHA-256 `8ecc7604d4c17c16e136d219a92e64747196d9ae044690e90be9ca0468b1ff12`),
a "FreeDOS Ripcord BootDisk". The upstream floppy also carries games, demos
and tools whose licences are unknown or not free, so the script removes them
and zeroes their data. What is left:

| File | What it is | Source |
| --- | --- | --- |
| `KERNEL.SYS` | FreeDOS kernel, build 2040 (compiled 7 April 2012), GPL-2.0-or-later, unmodified | See below |
| `COMMAND.COM` | FreeCOM 0.82 pl 3, GPL-2.0-or-later, unmodified | <https://github.com/FDOS/freecom/tree/com082pl3> |
| `README` | The boot disk's own README, unmodified | |
| `AUTOEXEC.BAT`, `CONFIG.SYS` | Rewritten by the script | |

The kernel is an untagged development build that predates the kernel's git
history. Its exact revision is not published as a tag: the nearest source is
the first commit of <https://github.com/FDOS/kernel>,
[`c431157`](https://github.com/FDOS/kernel/tree/c4311571563bad4496c994c108ae305b2548e000)
(build 2041, October 2012), and the earlier history is in the FreeDOS
Subversion archive at <https://sourceforge.net/p/freedos/svn/HEAD/tree/kernel/>.

FreeDOS is a trademark of Jim Hall. This project is not affiliated with or
endorsed by the FreeDOS Project, SeaBIOS or v86.

No Microsoft operating system is shipped here, and none should be committed.
To run one, use **Open disk image…** with an image you are licensed to use.

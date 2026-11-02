// PC Emulator: which virtual drive a disk image the user picked goes in.
export type Drive = "cdrom" | "fda" | "hda";

/** The largest floppy format, 2.88 MB. */
export const MAX_FLOPPY = 2880 * 1024;

export const driveFor = (name: string, size: number): Drive =>
  /\.iso$/i.test(name) ? "cdrom" : size <= MAX_FLOPPY ? "fda" : "hda";

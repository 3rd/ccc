// mounts a private tmpfs over each target directory. must run inside a user
// namespace created with --keep-caps so CAP_SYS_ADMIN survives the exec; the
// mounts are invisible outside the session's mount namespace.
#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <sys/mount.h>
#include <sys/stat.h>

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: ns-mount <dir>...\n");
    return 2;
  }
  for (int i = 1; i < argc; i++) {
    mkdir(argv[i], 0755);
    if (mount("tmpfs", argv[i], "tmpfs", MS_NOSUID | MS_NODEV, "mode=0755,size=64m") != 0) {
      fprintf(stderr, "ns-mount %s: %s\n", argv[i], strerror(errno));
      // roll back earlier mounts so a partial failure never leaves empty
      // tmpfs shadowing real directories
      for (int j = i - 1; j >= 1; j--) umount2(argv[j], MNT_DETACH);
      return 1;
    }
  }
  return 0;
}

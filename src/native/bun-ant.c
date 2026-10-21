// node add-on for the Bun.ant members claude code calls on linux: socket peer
// credentials, prctl(PR_SET_DUMPABLE) and login_tty.
//
// it declares the few node-api functions it uses instead of including
// node_api.h, so it builds without node headers; node resolves them when it
// loads the add-on.
#define _GNU_SOURCE
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <sys/ioctl.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <unistd.h>

typedef struct napi_env__ *napi_env;
typedef struct napi_value__ *napi_value;
typedef struct napi_callback_info__ *napi_callback_info;
typedef napi_value (*napi_callback)(napi_env env, napi_callback_info info);
typedef enum { napi_ok } napi_status;

#define NAPI_AUTO_LENGTH SIZE_MAX

napi_status napi_get_cb_info(napi_env env, napi_callback_info info, size_t *argc, napi_value *argv,
                             napi_value *this_arg, void **data);
napi_status napi_get_value_int32(napi_env env, napi_value value, int32_t *result);
napi_status napi_get_value_bool(napi_env env, napi_value value, bool *result);
napi_status napi_create_int32(napi_env env, int32_t value, napi_value *result);
napi_status napi_create_uint32(napi_env env, uint32_t value, napi_value *result);
napi_status napi_get_boolean(napi_env env, bool value, napi_value *result);
napi_status napi_get_null(napi_env env, napi_value *result);
napi_status napi_create_function(napi_env env, const char *utf8name, size_t length, napi_callback cb,
                                 void *data, napi_value *result);
napi_status napi_set_named_property(napi_env env, napi_value object, const char *utf8name, napi_value value);

static napi_value read_first_argument(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1] = {NULL};
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  return argv[0];
}

static int32_t read_descriptor(napi_env env, napi_callback_info info) {
  int32_t descriptor = -1;
  napi_get_value_int32(env, read_first_argument(env, info), &descriptor);
  return descriptor;
}

static bool read_peer_credentials(napi_env env, napi_callback_info info, struct ucred *credentials) {
  socklen_t length = sizeof *credentials;
  return getsockopt(read_descriptor(env, info), SOL_SOCKET, SO_PEERCRED, credentials, &length) == 0;
}

static napi_value get_peer_pid(napi_env env, napi_callback_info info) {
  struct ucred credentials;
  napi_value result;

  if (!read_peer_credentials(env, info, &credentials)) {
    napi_get_null(env, &result);
    return result;
  }

  napi_create_int32(env, credentials.pid, &result);
  return result;
}

static napi_value get_peer_uid(napi_env env, napi_callback_info info) {
  struct ucred credentials;
  napi_value result;

  if (!read_peer_credentials(env, info, &credentials)) {
    napi_get_null(env, &result);
    return result;
  }

  napi_create_uint32(env, credentials.uid, &result);
  return result;
}

static napi_value set_dumpable(napi_env env, napi_callback_info info) {
  bool is_dumpable = false;
  napi_value result;
  napi_get_value_bool(env, read_first_argument(env, info), &is_dumpable);
  napi_get_boolean(env, prctl(PR_SET_DUMPABLE, is_dumpable ? 1 : 0, 0, 0, 0) == 0, &result);
  return result;
}

// login_tty(3) without libc's copy: glibc before 2.34 keeps it in libutil, so a
// call from this add-on would abort the process with an unresolved symbol there
static bool make_controlling_terminal(int32_t descriptor) {
  setsid();

  if (ioctl(descriptor, TIOCSCTTY, NULL) != 0) return false;

  for (int standard_descriptor = 0; standard_descriptor <= 2; standard_descriptor++) {
    if (dup2(descriptor, standard_descriptor) < 0) return false;
  }

  if (descriptor > 2) {
    close(descriptor);
  }

  return true;
}

static napi_value login_tty_on(napi_env env, napi_callback_info info) {
  napi_value result;
  napi_get_boolean(env, make_controlling_terminal(read_descriptor(env, info)), &result);
  return result;
}

napi_value napi_register_module_v1(napi_env env, napi_value exports) {
  static const struct {
    const char *name;
    napi_callback callback;
  } members[] = {
      {"getPeerPid", get_peer_pid},
      {"getPeerUid", get_peer_uid},
      {"setDumpable", set_dumpable},
      {"loginTty", login_tty_on},
  };

  for (size_t index = 0; index < sizeof members / sizeof members[0]; index++) {
    napi_value member;
    napi_create_function(env, members[index].name, NAPI_AUTO_LENGTH, members[index].callback, NULL, &member);
    napi_set_named_property(env, exports, members[index].name, member);
  }

  return exports;
}

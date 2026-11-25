/*
 * Takes Cloud Files callbacks for the provider process.
 *
 * Windows calls a sync root's callbacks on threads of its own, and the
 * structures it passes are gone when the callback returns. JavaScript runs on
 * one thread and can only be reached after that, so each callback copies the
 * fields the provider acts on into a fixed queue, and the provider polls it.
 *
 * The offsets are those of CF_CALLBACK_INFO and CF_CALLBACK_PARAMETERS in
 * cfapi.h on a 64-bit build.
 */
typedef unsigned int u32;
typedef unsigned short u16;
typedef long long i64;
typedef unsigned char u8;

#define IDENTITY_MAX 256
#define PATH_MAX 1024

typedef struct {
  u32 type; /* CF_CALLBACK_TYPE */
  u32 identityLen;
  i64 transferKey;
  i64 requestKey;
  i64 offset; /* FETCH_DATA: the range asked for */
  i64 length;
  u8 identity[IDENTITY_MAX]; /* the file identity the placeholder carries */
  u32 pathLen; /* UTF-16 units in `path`, 0 for none and for a path longer than it */
  u32 pad;
  u16 path[PATH_MAX]; /* where the placeholder is, from the volume's root */
} Event;

#define QCAP 1024
static Event queue[QCAP];
static volatile u32 head, tail;
static volatile int lk, dropped;

static void lock(void) {
  int one;
  do {
    one = 1;
    __asm__("xchgl %0, %1" : "+r"(one), "+m"(lk));
  } while (one);
}
static void unlock(void) { lk = 0; }

static void push(u32 type, const u8 *info, const u8 *params) {
  lock();
  u32 next = (head + 1) % QCAP;
  if (next == tail) {
    dropped = 1;
  } else {
    Event *e = &queue[head];
    e->type = type;
    e->transferKey = *(const i64 *)(info + 112);
    e->requestKey = *(const i64 *)(info + 144);
    e->offset = type == 0 ? *(const i64 *)(params + 16) : 0;
    e->length = type == 0 ? *(const i64 *)(params + 24) : 0;
    const u8 *id = *(const u8 *const *)(info + 88);
    u32 n = id ? *(const u32 *)(info + 96) : 0;
    /* The provider writes no identity this long, so one is another program's. */
    if (n > IDENTITY_MAX) n = 0;
    e->identityLen = n;
    for (u32 i = 0; i < n; i++) e->identity[i] = id[i];
    const u16 *path = *(const u16 *const *)(info + 104);
    n = 0;
    while (path && n < PATH_MAX && path[n]) n++;
    if (n == PATH_MAX) n = 0;
    e->pathLen = n;
    for (u32 i = 0; i < n; i++) e->path[i] = path[i];
    head = next;
  }
  unlock();
}

static void on_fetch(const u8 *i, const u8 *p) { push(0, i, p); }
static void on_open(const u8 *i, const u8 *p) { push(5, i, p); }
static void on_close(const u8 *i, const u8 *p) { push(6, i, p); }
static void on_dehydrated(const u8 *i, const u8 *p) { push(8, i, p); }
static void on_deleted(const u8 *i, const u8 *p) { push(10, i, p); }
static void on_renamed(const u8 *i, const u8 *p) { push(12, i, p); }

/*
 * Copies the oldest event into `out` and returns 1, or returns 0 with none.
 * Returns -1 once after the queue filled and events were dropped.
 */
int cf_poll(Event *out) {
  lock();
  int result = 0;
  if (dropped) {
    dropped = 0;
    result = -1;
  } else if (tail != head) {
    *out = queue[tail];
    tail = (tail + 1) % QCAP;
    result = 1;
  }
  unlock();
  return result;
}

/* Fills a CF_CALLBACK_REGISTRATION array, 16 bytes an entry, ended by NONE. */
void cf_table(u8 *out) {
  static const u32 types[6] = {0, 5, 6, 8, 10, 12};
  void *fns[6] = {on_fetch, on_open, on_close, on_dehydrated, on_deleted, on_renamed};
  for (int i = 0; i < 6; i++) {
    *(u32 *)(out + i * 16) = types[i];
    *(void **)(out + i * 16 + 8) = fns[i];
  }
  *(u32 *)(out + 6 * 16) = 0xffffffff;
  *(void **)(out + 6 * 16 + 8) = 0;
}

// Every #if branch is parsed; a class defined in two branches is merged by the graph builder.
#include "core/device.h"
#include <vector>

#ifdef USE_GPU
class Backend {
public:
  GpuContext context;
};
#else
class Backend {
public:
  CpuContext context;
};
#endif

class Engine {
#if defined(FAST)
  int fast;
#elif defined(SLOW)
  int slow;
#endif
public:
  void run();
};

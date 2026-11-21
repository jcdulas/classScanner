#include "tools.h"

int main() {
  Pool pool;
  auto take = [&pool] { return pool.nextJob(); };
  take()->run();
  return 0;
}

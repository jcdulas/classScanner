// Nested, C++17 and anonymous namespaces, aliases, and using directives.
using namespace std;

namespace app {
namespace core {
class Engine;
class Service {};
}  // namespace core

namespace net::http {
class Request {};
using RequestList = std::vector<Request>;
typedef std::map<int, Request*> RequestMap;
}  // namespace net::http

typedef struct {
  int x;
  int y;
} Point;
}  // namespace app

namespace {
class Hidden {};
}

extern "C" {
struct CStruct {
  int field;
};
}

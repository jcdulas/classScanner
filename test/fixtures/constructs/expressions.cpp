// Calls on expressions: what the parser keeps of the object of each call, to find its type.
#include "expressions.hpp"

void Pool::work(Queue& queue) {
  auto* job = nextJob();
  job->run();
  queue.front()->run();
  Registry::instance().find("a")->stop();
  auto task = std::make_unique<Task>();
  task->start();
  static_cast<Worker*>(job)->pause();
  (new Timer())->reset();
  this->logger.sink().flush();
  for (auto& item : queue.items()) {
    item.cancel();
  }
  auto copy = job;
  copy->abort();
  jobs[0].resume();
  (*current).wake();
  auto pick = [this] { return nextJob(); };
  pick()->skip();
  (first + second).merge();
  int limit = 3;
  registry.find(42, -1.5, 'c', true, nullptr, "text", job, limit)->stop();
}

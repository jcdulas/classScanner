#include "tools.h"

void Job::run() {}

void Task::run() {}

Job* Pool::nextJob() { return new Job(); }

Task* Pool::nextTask() { return new Task(); }

void Pool::work() {
  // Nothing tells the scan what a lambda returns, and Pool knows two classes that have a `run`.
  auto next = [this] { return nextJob(); };
  next()->run();
  // The scan follows this one: `nextTask()` is declared to return a Task.
  nextTask()->run();
}

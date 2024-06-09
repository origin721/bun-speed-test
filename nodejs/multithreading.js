//@ts-check
const { fork } = require('child_process');
const os = require('os');
const { log } = require('./create-log');

const numCPUs = Math.max(os.cpus().length - 1, 1);

module.exports = {
    multithreading,
    connectChildMultithreading,
}

function multithreading(path) {
    const workers = [];
    const taskQueues = [];
    const pendingTasks = [];
    let activeWorkers = 0;

    // Создание дочерних процессов
    const createWorker = (index) => {
        const worker = fork(path);
        workers[index] = worker;
        taskQueues[index] = [];

        worker.on('message', (message) => {
            const taskQueue = taskQueues[index];
            if (taskQueue.length > 0) {
                const { resolve } = taskQueue.shift();
                resolve(message);
            }

            checkPendingTasks();
            checkAndTerminateWorker(index);
        });

        worker.on('error', (error) => {
            const taskQueue = taskQueues[index];
            if (taskQueue.length > 0) {
                const { reject } = taskQueue.shift();
                reject(error);
            }

            checkPendingTasks();
            checkAndTerminateWorker(index);
        });

        worker.on('exit', (code) => {
            if (code !== 0) {
                const taskQueue = taskQueues[index];
                if (taskQueue.length > 0) {
                    const { reject } = taskQueue.shift();
                    reject(new Error(`Child process exited with code ${code}`));
                }
            }
        });

        ++activeWorkers;
    };

    const checkAndTerminateWorker = (index) => {
        if (taskQueues[index].length === 0 && pendingTasks.length === 0) {
            workers[index].kill();
            workers[index] = null;
            --activeWorkers;
        }
    };

    const checkPendingTasks = () => {
        while (pendingTasks.length > 0) {
            let workerIndex = -1;

            // Найти процесс с количеством задач меньше 5
            for (let i = 0; i < workers.length; i++) {
                if (workers[i] && taskQueues[i].length < 5) {
                    workerIndex = i;
                    break;
                }
            }

            if (workerIndex === -1) {
                break;
            }

            const { resolve, reject, args } = pendingTasks.shift();
            const worker = workers[workerIndex];
            const taskQueue = taskQueues[workerIndex];

            taskQueue.push({ resolve, reject, args });
            worker.send(args);
        }
    };

    // const checkCpuLoad = () => {
    //     const cpus = os.cpus();
    //     const averageLoad = cpus.reduce((total, cpu) => {
    //         const { user, nice, sys, idle, irq } = cpu.times;
    //         const totalLoad = user + nice + sys + irq;
    //         return total + (totalLoad / (totalLoad + idle));
    //     }, 0) / cpus.length;

    //     return averageLoad > 0.9;
    // };

    // const waitForLowCpuLoad = (intervalMs) => {
    //     return new Promise((resolve) => {
    //         const interval = setInterval(() => {
    //             if (!checkCpuLoad()) {
    //                 clearInterval(interval);
    //                 resolve();
    //             }
    //         }, intervalMs);
    //     });
    // };

    return async (...args) => {
        // if (checkCpuLoad()) {
        //     await waitForLowCpuLoad(1000);
        // }

        return new Promise((resolve, reject) => {
            let workerIndex = -1;

            // Найти процесс с количеством задач меньше 5
            for (let i = 0; i < workers.length; i++) {
                if (workers[i] && taskQueues[i].length < 5) {
                    workerIndex = i;
                    break;
                }
            }

            if (workerIndex === -1) {
                if (activeWorkers < numCPUs) {
                    workerIndex = workers.length;
                    createWorker(workerIndex);
                } else {
                    pendingTasks.push({ resolve, reject, args });
                    return;
                }
            }

            const worker = workers[workerIndex];
            const taskQueue = taskQueues[workerIndex];

            taskQueue.push({ resolve, reject, args });
            worker.send(args);
        });
    };
}

function connectChildMultithreading(callback) {
    process.on('message', async (args) => {
        try {
            // Обработка аргументов и добавление нового поля
            const result = await callback(...args);

            // Отправка результата обратно родительскому процессу
            process.send(result);
        } catch (err) {
            process.send(null);
            console.error(__filename, callback.name, { args }, err);
        }
    });
}

import Docker from "dockerode";
import { pack } from "tar-stream";

async function main() {
    const docker = new Docker();
    const container = await docker.createContainer({
        Image: "node:20-slim",
        Cmd: ["sleep", "infinity"],
        WorkingDir: "/workspace",
        HostConfig: {
            ReadonlyRootfs: true,
            Tmpfs: {
                "/tmp": "size=100M",
                "/workspace": "size=500M",
            },
        },
    });

    console.log("Container created", container.id);
    await container.start();
    console.log("Container started");

    try {
        const archive = pack();
        archive.entry({ name: "test.txt" }, "hello world");
        archive.finalize();

        console.log("Trying exec tar x -C /workspace...");
        const exec = await container.exec({
            Cmd: ["tar", "-x", "-C", "/workspace"],
            AttachStdin: true,
            AttachStdout: true,
            AttachStderr: true,
        });

        const stream = await exec.start({ stdin: true, hijack: true });

        docker.modem.demuxStream(stream, process.stdout, process.stderr);

        await new Promise((resolve, reject) => {
            archive.pipe(stream);
            archive.on('end', resolve);
            archive.on('error', reject);
        });

        console.log("Archive piped to exec tar");

        let inspect = await exec.inspect();
        while (inspect.Running) {
            await new Promise(r => setTimeout(r, 100));
            inspect = await exec.inspect();
        }

        console.log(`Exec exit code: ${inspect.ExitCode}`);

        if (inspect.ExitCode !== 0) {
            console.error("Tar failed!");
        }

        const check = await container.exec({
            Cmd: ["cat", "/workspace/test.txt"],
            AttachStdout: true,
            AttachStderr: true,
        });
        const checkStream = await check.start({ Detach: false });
        checkStream.pipe(process.stdout);

        await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (e: any) {
        console.error("Error:", e.message);
    } finally {
        await container.remove({ force: true });
        console.log("Container removed");
    }
}

main().catch(console.error);
